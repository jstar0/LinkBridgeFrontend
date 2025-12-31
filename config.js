export default {
  // LinkBridge runs against a real backend (Go service).
  // You can override it at runtime by setting `lb_base_url` in storage.
  isMock: false,
  baseUrl: 'http://localhost:8080',
};
