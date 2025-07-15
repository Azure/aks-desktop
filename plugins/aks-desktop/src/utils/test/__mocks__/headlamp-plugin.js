// Mock for @kinvolk/headlamp-plugin/lib

const runCommand = jest.fn().mockReturnValue({
  stdout: {
    on: jest.fn(),
  },
  stderr: {
    on: jest.fn(),
  },
  on: jest.fn(),
});

// Mock K8s ResourceClasses
const mockPod = {
  getName: jest.fn().mockReturnValue('test-pod'),
  getNamespace: jest.fn().mockReturnValue('default'),
  metadata: {
    name: 'test-pod',
    namespace: 'default',
  },
  spec: {
    containers: [{ name: 'test-container' }],
  },
  status: { phase: 'Running' },
  getLogs: jest.fn().mockImplementation((container, callback) => {
    callback({ logs: ['test log line 1', 'test log line 2'] });
    return jest.fn(); // cleanup function
  }),
  apiList: jest.fn().mockImplementation(onList => {
    onList([mockPod]);
    return jest.fn(); // cancel function
  }),
};

const mockDeployment = {
  getName: jest.fn().mockReturnValue('test-deployment'),
  getNamespace: jest.fn().mockReturnValue('default'),
  metadata: {
    name: 'test-deployment',
    namespace: 'default',
    labels: { app: 'test' },
  },
  spec: {
    replicas: 2,
    template: {
      spec: {
        containers: [{ name: 'test-container', image: 'nginx:latest' }],
      },
    },
  },
  status: {
    replicas: 2,
    readyReplicas: 2,
  },
  apiList: jest.fn().mockImplementation(onList => {
    onList([mockDeployment]);
    return jest.fn(); // cancel function
  }),
};

const K8s = {
  ResourceClasses: {
    Pod: {
      ...mockPod,
      apiList: jest.fn().mockImplementation(onList => {
        onList([mockPod]);
        return jest.fn(); // cancel function
      }),
    },
    Deployment: {
      ...mockDeployment,
      apiList: jest.fn().mockImplementation(onList => {
        onList([mockDeployment]);
        return jest.fn(); // cancel function
      }),
    },
  },
};

module.exports = {
  runCommand,
  K8s,
};
