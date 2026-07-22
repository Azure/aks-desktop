/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useQuery } from '@tanstack/react-query';
import React, { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { Redirect, Route, RouteProps, Switch, useHistory } from 'react-router-dom';
import { getCluster, getSelectedClusters } from '../../lib/cluster';
import { useCluster, useClustersConf } from '../../lib/k8s';
import { testAuth } from '../../lib/k8s/api/v1/clusterApi';
import { NotFoundRoute } from '../../lib/router';
import { createRouteURL } from '../../lib/router/createRouteURL';
import { getDefaultRoutes } from '../../lib/router/getDefaultRoutes';
import { getRoutePath } from '../../lib/router/getRoutePath';
import { getRouteUseClusterURL } from '../../lib/router/getRouteUseClusterURL';
import { Route as RouteType } from '../../lib/router/Route';
import { clearClusterPreparing, setClusterPreparing } from '../../redux/clusterProviderSlice';
import { useTypedSelector } from '../../redux/hooks';
import { uiSlice } from '../../redux/uiSlice';
import ErrorBoundary from '../common/ErrorBoundary';
import ErrorComponent from '../common/ErrorPage';
import { useSidebarItem } from '../Sidebar';
import ClusterPreparingDialog from './ClusterPreparingDialog';

export default function RouteSwitcher(props: { requiresToken: () => boolean }) {
  // The NotFoundRoute always has to be evaluated in the last place.
  const routes = useTypedSelector(state => state.routes.routes);
  const routeFilters = useTypedSelector(state => state.routes.routeFilters);
  const defaultRoutes = Object.values(getDefaultRoutes()).concat(NotFoundRoute);
  const clusters = useClustersConf();
  const filteredRoutes = Object.values(routes)
    .concat(defaultRoutes)
    .filter(
      route =>
        !(
          routeFilters.length > 0 &&
          routeFilters.filter(f => f(route)).length !== routeFilters.length
        ) && !route.disabled
    );

  return (
    <Suspense fallback={null}>
      <Switch>
        {filteredRoutes.map((route, index) =>
          route.name === 'OidcAuth' ? (
            <Route
              path={route.path}
              component={() => <RouteComponent route={route} />}
              key={index}
            />
          ) : (
            <AuthRoute
              path={getRoutePath(route)}
              sidebar={route.sidebar}
              requiresAuth={!route.noAuthRequired}
              requiresCluster={getRouteUseClusterURL(route)}
              exact={!!route.exact}
              clusters={clusters}
              requiresToken={props.requiresToken}
              children={
                <RouteComponent route={route} key={`${getRoutePath(route)}-${getCluster()}`} />
              }
              key={`${getRoutePath(route)}-${getCluster()}`}
            />
          )
        )}
      </Switch>
    </Suspense>
  );
}

function RouteErrorBoundary(props: { error: Error; route: RouteType }) {
  const { error, route } = props;
  const { t } = useTranslation();
  return (
    <ErrorComponent
      title={t('Uh-oh! Something went wrong.')}
      error={error}
      message={t('translation|Error loading {{ routeName }}', { routeName: route.name })}
    />
  );
}

function RouteComponent({ route }: { route: RouteType }) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  React.useEffect(() => {
    dispatch(uiSlice.actions.setHideAppBar(route.hideAppBar));
  }, [route.hideAppBar, dispatch]);

  React.useEffect(() => {
    dispatch(uiSlice.actions.setIsFullWidth(route.isFullWidth));
  }, [route.isFullWidth, dispatch]);

  return (
    <PageTitle
      title={t(
        route.name
          ? route.name
          : typeof route.sidebar === 'string'
          ? route.sidebar
          : route.sidebar?.item || ''
      )}
    >
      <ErrorBoundary
        fallback={(props: { error: Error }) => (
          <RouteErrorBoundary error={props.error} route={route} />
        )}
      >
        <route.component />
      </ErrorBoundary>
    </PageTitle>
  );
}

function PageTitle({
  title,
  children,
}: {
  title: string | null | undefined;
  children: React.ReactNode;
}) {
  const cluster = useCluster();

  React.useEffect(() => {
    if (cluster && title) {
      document.title = `${cluster} - ${title}`;
      return;
    }

    document.title = cluster || title || '';
  }, [cluster, title]);

  return <>{children}</>;
}

interface AuthRouteProps {
  children: React.ReactNode;
  sidebar: RouteType['sidebar'];
  requiresAuth: boolean;
  requiresCluster: boolean;
  requiresToken: () => boolean;
  [otherProps: string]: any;
}

export function AuthRoute(props: AuthRouteProps) {
  const {
    children,
    sidebar,
    requiresAuth = true,
    requiresCluster = true,
    computedMatch = {},
    ...other
  } = props;

  const { t } = useTranslation();
  const dispatch = useDispatch();
  useSidebarItem(sidebar, computedMatch);
  const cluster = useCluster();

  const clusters = useClustersConf();
  const currentClusterConf = (cluster && clusters ? clusters[cluster] : null) ?? null;

  // Pre-open hooks let plugins prepare a cluster (start a proxy, refresh
  // credentials, write a kubeconfig context, …) before its views load. They run
  // for a single opened cluster only; in multi-cluster mode we cannot attribute
  // preparation to one cluster, so we skip them (mirroring the auth handling
  // below). They must complete before we probe auth, since the auth probe talks
  // to the cluster's API and may depend on the preparation (e.g. a proxy).
  const preOpenHooks = useTypedSelector(state => state.clusterProvider.preOpenHooks);
  const isSingleCluster = getSelectedClusters().length <= 1;
  const preOpenEnabled = !!cluster && requiresCluster && isSingleCluster && preOpenHooks.length > 0;
  const preOpenQuery = useQuery({
    queryKey: ['clusterPreOpen', cluster],
    queryFn: async () => {
      // Capture the cluster this run prepares so cleanup stays keyed to it even
      // if the user navigates to a different cluster while hooks are running.
      const preparingCluster = cluster!;
      // Mark the cluster as preparing so the connecting popup shows and the
      // "Lost connection" health banner is suppressed while hooks run.
      dispatch(setClusterPreparing({ cluster: preparingCluster }));
      const reportProgress = (message: string) =>
        dispatch(setClusterPreparing({ cluster: preparingCluster, message }));
      try {
        for (const hook of preOpenHooks) {
          await hook({
            cluster: preparingCluster,
            clusterConf: currentClusterConf,
            reportProgress,
          });
        }
        return true;
      } finally {
        // Clear deterministically for the cluster we prepared (on success or
        // error) so a mid-run navigation can't leave a stale "preparing" entry.
        dispatch(clearClusterPreparing(preparingCluster));
      }
    },
    enabled: preOpenEnabled,
    retry: 0,
    // Prepare a cluster once per open: staleTime keeps hooks from re-running
    // while the cluster page stays mounted, and gcTime: 0 evicts the result on
    // unmount so leaving and re-opening the cluster re-runs preparation (rather
    // than reusing a cached success and skipping a proxy that may have died).
    staleTime: Infinity,
    gcTime: 0,
  });

  // The latest progress message a hook reported for this cluster (drives the
  // connecting popup's text). Undefined when the cluster isn't preparing.
  const preparingMessage = useTypedSelector(state =>
    cluster ? state.clusterProvider.preparing?.[cluster] : undefined
  );

  // (The preparing flag is cleared in the query's `finally` above, keyed to the
  // cluster that was prepared — deterministic even across mid-run navigation.)

  const query = useQuery({
    queryKey: ['auth', cluster],
    queryFn: () => testAuth(cluster!),
    // Wait for pre-open preparation before probing auth against the cluster.
    enabled: !!cluster && requiresAuth && (!preOpenEnabled || preOpenQuery.isSuccess),
    retry: 0,
  });

  const currentCluster = getCluster();
  const clusterConf = currentCluster && clusters ? clusters[currentCluster] : null;
  const authError = query.error as any;
  const isExplicitAuthError = [401, 403].includes(authError?.status);

  let redirectRoute: string;

  if (!currentCluster) {
    redirectRoute = 'chooser';
  } else if (clusterConf?.auth_type === 'oidc') {
    redirectRoute = 'login';
  } else if (query.isError && isExplicitAuthError) {
    redirectRoute = 'token';
  } else {
    redirectRoute = 'login';
  }

  function getRenderer({ location }: RouteProps) {
    // Gate the cluster's views on any registered pre-open preparation. This runs
    // before the auth check below, and for both auth and no-auth cluster routes.
    if (preOpenEnabled) {
      if (preOpenQuery.isError) {
        const detail =
          preOpenQuery.error instanceof Error
            ? preOpenQuery.error.message
            : String(preOpenQuery.error);
        return (
          <ErrorComponent
            title={t('translation|Could not open cluster')}
            error={preOpenQuery.error instanceof Error ? preOpenQuery.error : undefined}
            message={
              <>
                {detail}
                <Box mt={2}>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={() => preOpenQuery.refetch()}
                  >
                    {t('translation|Retry')}
                  </Button>
                </Box>
              </>
            }
          />
        );
      }
      if (!preOpenQuery.isSuccess) {
        // A modal "connecting" popup (rather than a bare page loader) so opening
        // the cluster reads as a deliberate connect step. Only the dialog renders
        // while preparation is pending; the cluster's views render once it
        // succeeds (this renderer returns `children` on success, below).
        return <ClusterPreparingDialog cluster={cluster!} message={preparingMessage} />;
      }
    }

    if (!requiresAuth) {
      return children;
    }

    if (requiresCluster) {
      if (getSelectedClusters().length > 1) {
        // In multi-cluster mode, we do not know if one of them requires a token.
        return children;
      }
    }

    if (query.isSuccess) {
      return children;
    }

    if (query.isError) {
      return (
        <Redirect
          to={{
            pathname: createRouteURL(redirectRoute),
            state: { from: location },
          }}
        />
      );
    }

    return null;
  }

  // If no auth is required for the view, or the token is set up, then
  // render the assigned component. Otherwise redirect to the login route.
  return <Route {...other} render={getRenderer} />;
}

const PreviousRouteContext = React.createContext<number>(0);

export function PreviousRouteProvider({ children }: React.PropsWithChildren<{}>) {
  const history = useHistory();
  const [locationInfo, setLocationInfo] = React.useState<number>(0);

  React.useEffect(() => {
    const unlisten = history.listen((location, action) => {
      if (action === 'PUSH') {
        setLocationInfo(levels => levels + 1);
      } else if (action === 'POP') {
        setLocationInfo(levels => levels - 1);
      }
    });
    return unlisten;
  }, [history]);

  return (
    <PreviousRouteContext.Provider value={locationInfo}>{children}</PreviousRouteContext.Provider>
  );
}

export function useHasPreviousRoute() {
  const routeLevels = React.useContext(PreviousRouteContext);
  return routeLevels >= 1;
}
