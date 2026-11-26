import { appIcon } from './free-apps-section';

describe('appIcon', () => {
  it('uses the WordPress mark for WordPress-based apps, whatever the case', () => {
    expect(appIcon('WordPress')).toBe('wordpress');
    expect(appIcon('woocommerce')).toBe('wordpress');
  });

  it('uses a generic mark for everything else', () => {
    expect(appIcon('Joomla')).toBe('layers');
    expect(appIcon('Drupal')).toBe('layers');
  });
});
