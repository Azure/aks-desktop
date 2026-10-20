// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  ButtonBase,
  CircularProgress,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import type { Octokit } from '@octokit/rest';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import { listUserRepos, type RepoListItem } from '../../../utils/github/github-api';
import { isGitHubSessionCurrent } from '../../../utils/github/github-session';

interface RepoSelectorProps {
  octokit: Octokit;
  sessionVersion: number;
  selectedRepo: GitHubRepo | null;
  onRepoSelect: (repo: GitHubRepo) => void;
}

export function RepoSelector({
  octokit,
  sessionVersion,
  selectedRepo,
  onRepoSelect,
}: RepoSelectorProps) {
  const { t } = useTranslation();
  const [model, setModel] = useState({
    sessionVersion,
    repos: [] as RepoListItem[],
    loading: true,
    failed: false,
  });
  const [filter, setFilter] = useState('');
  const versionRef = useRef(sessionVersion);
  versionRef.current = sessionVersion;
  useEffect(() => {
    let active = true;
    const current = () =>
      active && versionRef.current === sessionVersion && isGitHubSessionCurrent(sessionVersion);
    setFilter('');
    setModel({ sessionVersion, repos: [], loading: true, failed: false });
    void listUserRepos(octokit, {
      per_page: 100,
      onPage: repos => {
        if (current())
          setModel({ sessionVersion, repos: [...repos], loading: false, failed: false });
      },
    })
      .catch(() => {
        if (current()) setModel(previous => ({ ...previous, failed: true }));
      })
      .finally(() => {
        if (current()) setModel(previous => ({ ...previous, loading: false }));
      });
    return () => {
      active = false;
    };
  }, [octokit, sessionVersion]);
  const repos = model.sessionVersion === sessionVersion ? model.repos : [];
  const loading = model.sessionVersion !== sessionVersion || model.loading;
  const error =
    model.sessionVersion === sessionVersion && model.failed
      ? t('Failed to load repositories')
      : null;

  const filtered = useMemo(
    () =>
      filter ? repos.filter(r => r.fullName.toLowerCase().includes(filter.toLowerCase())) : repos,
    [repos, filter]
  );

  const isSelected = (r: RepoListItem) =>
    selectedRepo?.owner === r.owner && selectedRepo?.repo === r.name;

  return (
    <Box>
      <TextField
        size="small"
        placeholder={t('Filter repositories')}
        aria-label={t('Filter repositories')}
        value={filter}
        onChange={e => setFilter(e.target.value)}
        fullWidth
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <Icon icon="mdi:chevron-down" />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 1 }}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}

      <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
        {!loading && !error && filtered.length === 0
          ? filter
            ? t('No repositories match your filter')
            : t('No repositories found')
          : ''}
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      ) : filtered.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>
          {filter ? t('No repositories match your filter') : t('No repositories found')}
        </Typography>
      ) : (
        <Box
          sx={{
            maxHeight: 280,
            overflow: 'auto',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          {filtered.map((r, i) => (
            <ButtonBase
              key={r.fullName}
              onClick={() =>
                isGitHubSessionCurrent(sessionVersion) &&
                onRepoSelect({
                  owner: r.owner,
                  repo: r.name,
                  defaultBranch: r.defaultBranch,
                })
              }
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                width: '100%',
                px: 2,
                py: 1.25,
                textAlign: 'left',
                borderTop: i > 0 ? '1px solid' : 'none',
                borderColor: 'divider',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {isSelected(r) ? (
                <Box
                  component={Icon}
                  icon="mdi:check"
                  sx={{ color: 'text.primary', fontSize: 18, flexShrink: 0 }}
                />
              ) : (
                <Box sx={{ width: 18, flexShrink: 0 }} />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                  {r.fullName}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {r.defaultBranch}
                </Typography>
              </Box>
            </ButtonBase>
          ))}
        </Box>
      )}
    </Box>
  );
}
