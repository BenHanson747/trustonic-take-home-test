import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { queryCache } from '../data';
import { handlers } from '../mocks/handlers';

export const server = setupServer(...handlers);

beforeAll(() => server.listen());
beforeEach(() => queryCache.clear());
afterEach(() => {
  server.resetHandlers();
  queryCache.clear();
});
afterAll(() => server.close());
