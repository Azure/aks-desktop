import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockUseConfig = vi.hoisted(() => vi.fn());
const mockRegisterUIPanel = vi.hoisted(() => vi.fn());
const mockRegisterAppBarAction = vi.hoisted(() => vi.fn());
const mockRegisterPluginSettings = vi.hoisted(() => vi.fn());
const mockRegisterHeadlampEventCallback = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ConfigStore: vi.fn().mockImplementation(() => ({
    get: mockGet,
    update: mockUpdate,
    useConfig: () => mockUseConfig,
  })),
  registerUIPanel: mockRegisterUIPanel,
  registerAppBarAction: mockRegisterAppBarAction,
  registerPluginSettings: mockRegisterPluginSettings,
  registerHeadlampEventCallback: mockRegisterHeadlampEventCallback,
}));

vi.mock('@kinvolk/headlamp-plugin/lib/plugin/registry', () => ({
  DefaultHeadlampEvents: {
    OBJECT_EVENTS: 'headlamp.object-events',
    DETAILS_VIEW: 'headlamp.details-view',
    LIST_VIEW: 'headlamp.list-view',
  },
}));

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: vi.fn() }),
}));

vi.mock('use-between', () => ({
  useBetween: (hook: any) => hook(),
}));

vi.mock('@iconify/react', () => ({
  Icon: ({ icon, ...props }: any) => <span data-icon={icon} {...props} />,
}));

vi.mock('./agent/aksAgentManager', () => ({
  checkAksAgentInstalled: vi.fn().mockResolvedValue(null),
  getClustersFromHeadlampConfig: vi.fn().mockResolvedValue([]),
}));

vi.mock('./components', () => ({
  ModelSelector: () => <div data-testid="model-selector" />,
}));

vi.mock('./config/modelConfig', () => ({
  getDefaultConfig: vi.fn().mockReturnValue({}),
}));

vi.mock('./helper', () => ({
  isTestModeCheck: vi.fn().mockReturnValue(false),
}));

vi.mock('./modal', () => ({
  default: () => <div data-testid="ai-prompt" />,
}));

vi.mock('./utils/ProviderConfigManager', () => ({
  getActiveConfig: vi.fn().mockReturnValue(null),
  getSavedConfigurations: vi.fn().mockReturnValue({ providers: [] }),
}));

vi.mock('./utils/ToolConfigManager', () => ({
  getAllAvailableTools: vi.fn().mockReturnValue([]),
  isToolEnabled: vi.fn().mockReturnValue(false),
  toggleTool: vi.fn().mockReturnValue({}),
}));

describe('ai-assistant plugin registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('registers plugin settings, UI panel, and app bar actions on import', async () => {
    await import('./index');

    expect(mockRegisterUIPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'headlamp-ai',
        side: 'right',
      })
    );

    expect(mockRegisterAppBarAction).toHaveBeenCalled();
    expect(mockRegisterPluginSettings).toHaveBeenCalledWith('ai-assistant', expect.any(Function));
  });
});
