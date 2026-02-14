// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Octokit } from '@octokit/rest';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import { listUserRepos } from '../../../utils/github/github-api';

interface RepoSelectorProps {
  /** Authenticated Octokit client for fetching repos. */
  octokit: Octokit;
  /** Callback when user confirms a repository selection. */
  onRepoSelect: (repo: GitHubRepo) => void;
}

interface RepoItem {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
}

export const RepoSelector: React.FC<RepoSelectorProps> = ({ octokit, onRepoSelect }) => {
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [highlighted, setHighlighted] = useState<GitHubRepo | null>(null);

  const fetchRepos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listUserRepos(octokit, { per_page: 100 });
      setRepos(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repositories');
    } finally {
      setLoading(false);
    }
  }, [octokit]);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  const filtered = useMemo(
    () =>
      filter ? repos.filter(r => r.fullName.toLowerCase().includes(filter.toLowerCase())) : repos,
    [repos, filter]
  );

  const isHighlighted = (r: RepoItem) =>
    highlighted?.owner === r.owner && highlighted?.repo === r.name;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <TextField
          size="small"
          placeholder="Filter repositories..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          sx={{ flex: 1 }}
        />
        <Tooltip title="Refresh">
          <IconButton onClick={fetchRepos} disabled={loading} size="small">
            <Icon icon="mdi:refresh" />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      ) : filtered.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>
          {filter ? 'No repositories match your filter' : 'No repositories found'}
        </Typography>
      ) : (
        <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
          {filtered.map(r => (
            <Card
              key={r.fullName}
              variant="outlined"
              sx={{
                mb: 1,
                border: isHighlighted(r) ? '2px solid' : '1px solid',
                borderColor: isHighlighted(r) ? 'primary.main' : 'divider',
                transition: 'border-color 0.2s',
              }}
            >
              <CardActionArea
                onClick={() =>
                  setHighlighted({
                    owner: r.owner,
                    repo: r.name,
                    defaultBranch: r.defaultBranch,
                  })
                }
              >
                <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  {isHighlighted(r) && (
                    <Box
                      component={Icon}
                      icon="mdi:check-circle"
                      sx={{ color: 'primary.main', width: 20, height: 20 }}
                    />
                  )}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                      {r.fullName}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {r.defaultBranch}
                    </Typography>
                  </Box>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}

      <Button
        variant="contained"
        disabled={!highlighted}
        onClick={() => highlighted && onRepoSelect(highlighted)}
        sx={{ mt: 2, alignSelf: 'flex-end' }}
      >
        Continue
      </Button>
    </Box>
  );
};
