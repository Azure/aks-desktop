import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/components/common';
import Box from '@mui/material/Box';
import Switch from '@mui/material/Switch';

export function Settings(props) {
  const { data, onDataChange } = props;
  const { t } = useTranslation();

  const settingsRows = [
    {
      name: t('Display only AKS optimized Plugins'),
      value: (
        <Box sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <Switch
            checked={data?.displayOnlyAksOptimizedPlugins ?? true}
            inputProps={{ 'aria-label': t('Display only AKS optimized Plugins') }}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onDataChange({ ...data, displayOnlyAksOptimizedPlugins: event.target.checked })
            }
          />
        </Box>
      ),
    },
  ];

  return (
    <Box width={'100%'}>
      <NameValueTable rows={settingsRows} />
    </Box>
  );
}
