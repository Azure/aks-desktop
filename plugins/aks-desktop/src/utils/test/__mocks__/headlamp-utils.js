// Mock for @kinvolk/headlamp-plugin/lib/Utils

const mockGetCluster = jest.fn().mockReturnValue('test-cluster');

module.exports = {
  getCluster: mockGetCluster,
};
