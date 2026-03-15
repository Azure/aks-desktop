import { Icon } from '@iconify/react';
import {
  Box,
  CircularProgress,
  FormControl,
  MenuItem,
  Select,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';

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
          label="Chat"
          icon={<Icon icon="mdi:chat-outline" width="14px" />}
          iconPosition="start"
        />
        <Tab
          value="agent"
          label="Agent Mode"
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
              AKS Agent
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            on
          </Typography>

          {/* Cluster selector */}
          {isCheckingClusters ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CircularProgress size={12} />
              <Typography variant="caption" color="text.secondary">
                Checking clusters...
              </Typography>
            </Box>
          ) : aksAgentClusters.length === 0 ? (
            <Tooltip title="No clusters with AKS agent installed were found. Make sure the AKS agent is deployed on at least one connected cluster.">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Icon icon="mdi:alert-circle-outline" width="14px" style={{ color: 'orange' }} />
                <Typography variant="caption" color="text.secondary">
                  No clusters with AKS agent found
                </Typography>
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
