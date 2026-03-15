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
import type { Octokit } from '@octokit/rest';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import { listUserRepos, type RepoListItem } from '../../../utils/github/github-api';

interface RepoSelectorProps {
  octokit: Octokit;
  selectedRepo: GitHubRepo | null;
  onRepoSelect: (repo: GitHubRepo) => void;
}

export function RepoSelector({ octokit, selectedRepo, onRepoSelect }: RepoSelectorProps) {
  const { t } = useTranslation();
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const fetchRepos = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRepos([]);
    try {
      await listUserRepos(octokit, {
        per_page: 100,
        onPage: allReposSoFar => {
          setRepos(allReposSoFar);
          setLoading(false);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load repositories'));
    } finally {
      setLoading(false);
    }
  }, [octokit, t]);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

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
