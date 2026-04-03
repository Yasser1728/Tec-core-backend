import { Test, TestingModule } from '@nestjs/testing';
import { ProxyService }        from '../src/modules/proxy/proxy.service';

jest.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: jest.fn(() => jest.fn()),
}));

const appMock = { use: jest.fn() };

describe('ProxyService', () => {
  let service: ProxyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProxyService],
    }).compile();

    service = module.get<ProxyService>(ProxyService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerProxies', () => {
    it('registers routes on the express app', () => {
      service.registerProxies(appMock as any);
      expect(appMock.use).toHaveBeenCalled();
    });

    it('registers both v1 and legacy routes', () => {
      service.registerProxies(appMock as any);
      const calls = appMock.use.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((p: string) => p.startsWith('/api/v1/'))).toBe(true);
      expect(calls.some((p: string) => p.startsWith('/api/') && !p.startsWith('/api/v1/'))).toBe(true);
    });

    it('registers auth service route', () => {
      service.registerProxies(appMock as any);
      const calls = appMock.use.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((p: string) => p.includes('auth'))).toBe(true);
    });

    it('registers payment service route', () => {
      service.registerProxies(appMock as any);
      const calls = appMock.use.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((p: string) => p.includes('payment'))).toBe(true);
    });
  });
});
