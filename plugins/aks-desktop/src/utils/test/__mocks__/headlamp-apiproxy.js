// Mock for @kinvolk/headlamp-plugin/lib/ApiProxy

const mockApply = jest.fn().mockResolvedValue({
  metadata: {
    name: 'test-resource',
    namespace: 'default',
  },
});

module.exports = {
  apply: mockApply,
};
