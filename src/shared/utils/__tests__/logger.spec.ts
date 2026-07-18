import { MobileLogger } from '../logger';

describe('MobileLogger', () => {
  let logger: any;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';
    (global as any).__DEV__ = true;
    jest.resetModules();
    const { MobileLogger } = require('../logger');
    
    logger = new MobileLogger('TestContext');
    // suppress actual console output during test if needed
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
    jest.restoreAllMocks();
  });

  it('should log info with and without object', () => {
    logger.info('Message only');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[INFO] Message only'), expect.objectContaining({ component: 'TestContext' }));

    logger.info({ someData: 123 }, 'Message with object');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[INFO] Message with object'), expect.objectContaining({ someData: 123 }));
  });

  it('should log warn with and without object', () => {
    logger.warn('Message only');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[WARN] Message only'), expect.any(Object));
  });

  it('should log error with and without object', () => {
    logger.error('Message only');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Message only'), expect.any(Object));
  });
  
  it('should log debug with and without object', () => {
    logger.debug('Message only');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[DEBUG] Message only'), expect.any(Object));
  });
});

