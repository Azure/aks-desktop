import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  CircularProgress,
  FormControl,
  Link as MuiLink,
  MenuItem,
  Select,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { AKS_AGENT_INSTALL_DOC_URL } from '../../utils';

export type ChatMode = 'chat' | 'agent';

interface AgentModeSelectorProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  aksAgentClusters: string[];
  selectedAgentCluster: string;
  onAgentClusterChange: (cluster: string) => void;
  isCheckingClusters: boolean;
}

export const AgentModeSelector: React.FC<AgentModeSelectorProps> = ({
  mode,
  onModeChange,
  aksAgentClusters,
  selectedAgentCluster,
  onAgentClusterChange,
  isCheckingClusters,
}) => {
  const { t } = useTranslation();
  const handleTabChange = (_: React.SyntheticEvent, newValue: ChatMode) => {
    onModeChange(newValue);
  };

  return (
    <Box sx={{ mb: 1 }}>
      <Tabs
        value={mode}
        onChange={handleTabChange}
        sx={{
          minHeight: 32,
          '& .MuiTabs-indicator': { height: 2 },
          '& .MuiTab-root': { minHeight: 32, py: 0.5, fontSize: '0.75rem', textTransform: 'none' },
        }}
      >
        <Tab
          value="chat"
          label={t('Chat')}
          icon={<Icon icon="mdi:chat-outline" width="14px" />}
          iconPosition="start"
        />
        <Tab
          value="agent"
          label={t('Agent Mode')}
          icon={<Icon icon="mdi:robot-outline" width="14px" />}
          iconPosition="start"
        />
      </Tabs>

      {mode === 'agent' && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mt: 1,
            p: 1,
            borderRadius: 1,
            backgroundColor: 'action.hover',
          }}
        >
          {/* Agent label */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <Icon icon="mdi:kubernetes" width="16px" />
            <Typography variant="caption" fontWeight="bold">
              {t('AKS Agent')}
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {t('on')}
          </Typography>

          {/* Cluster selector */}
          {isCheckingClusters ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CircularProgress size={12} />
              <Typography variant="caption" color="text.secondary">
                {t('Checking clusters...')}
              </Typography>
            </Box>
          ) : aksAgentClusters.length === 0 ? (
            <Tooltip
              title={t(
                'No clusters with AKS agent installed were found. Make sure the AKS agent is deployed on at least one connected cluster.'
              )}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Icon icon="mdi:alert-circle-outline" width="14px" style={{ color: 'orange' }} />
                <Typography variant="caption" color="text.secondary">
                  {t('No clusters with AKS agent found')}
                </Typography>
                <MuiLink
                  href={AKS_AGENT_INSTALL_DOC_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="caption"
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
                >
                  {t('Learn how to enable')}
                  <Icon icon="mdi:open-in-new" width="12px" aria-hidden="true" focusable="false" />
                </MuiLink>
              </Box>
            </Tooltip>
          ) : (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <Select
                value={selectedAgentCluster}
                onChange={e => onAgentClusterChange(String(e.target.value))}
                sx={{ height: 28, fontSize: '0.75rem' }}
                displayEmpty
              >
                {aksAgentClusters.map(cluster => (
                  <MenuItem key={cluster} value={cluster} sx={{ fontSize: '0.75rem' }}>
                    {cluster}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>
      )}
    </Box>
  );
};

export default AgentModeSelector;
