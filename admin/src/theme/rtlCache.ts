import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';

/**
 * Passing `stylisPlugins` REPLACES emotion's defaults, so `prefixer` has to be
 * re-added by hand — dropping it silently kills all vendor prefixing.
 * The key must not collide with emotion's default 'css'.
 */
export const cacheRtl = createCache({
  key: 'muirtl',
  stylisPlugins: [prefixer, rtlPlugin],
});
