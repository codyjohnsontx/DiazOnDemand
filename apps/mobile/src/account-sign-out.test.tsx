/**
 * The second finding closed in PR #17: a failed sign-out used to be discarded, so
 * the protected screens stayed mounted and the SecureStore session token stayed
 * usable while the user was told nothing. Sign-out revokes the session at Clerk
 * and needs the network, so failing is an ordinary outcome, and the fix was to
 * report it rather than to clear local state and look signed out while the
 * session is still live.
 */
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
// Babel hoists the `jest.mock` calls below above this import, so the screen is
// loaded against them.
import { AccountScreen } from './mobile-app';
import { visibleText } from './test-support';

const mockSignOut = jest.fn();
// One stable object: the screen's API client is memoised on `getToken`, so a fresh
// one per render would re-run the `/me` effect forever.
const mockAuthToken = {
  getToken: async () => 'token_test',
  isDevelopmentBypass: false,
  signOut: mockSignOut,
};

jest.mock('./auth-provider', () => ({
  useAuthToken: () => mockAuthToken,
}));

// `mobile-app.tsx` imports the lesson player at module scope, and expo-av asks for
// a native module that only exists on a device. Nothing here touches the player.
jest.mock('expo-av', () => ({ Video: 'Video', ResizeMode: {} }));

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

const stillSignedIn = 'We could not sign you out, so you are still signed in on this device.';

function signOutButton(root: ReactTestInstance): ReactTestInstance {
  const [button] = root.findAll(
    (node) => typeof node.props.onPress === 'function' && /Sign(ing)? out/.test(node.props.title),
  );

  if (!button) {
    throw new Error('no sign-out button on screen');
  }

  return button;
}

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<AccountScreen />);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      role: 'MEMBER',
      entitlementTier: 'PREMIUM',
      subscriptionStatus: 'active',
    }),
  }) as unknown as typeof fetch;
});

it('says the user is still signed in when the revoke fails', async () => {
  mockSignOut.mockRejectedValue(new TypeError('Network request failed'));

  const tree = await render();
  await act(async () => {
    signOutButton(tree.root).props.onPress();
  });

  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(visibleText(tree)).toContain(stillSignedIn);
});

it('refuses a second press while one revoke is in flight', async () => {
  let release!: () => void;
  mockSignOut.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );

  const tree = await render();
  await act(async () => {
    signOutButton(tree.root).props.onPress();
  });

  expect(signOutButton(tree.root).props.disabled).toBe(true);

  await act(async () => {
    signOutButton(tree.root).props.onPress();
  });

  expect(mockSignOut).toHaveBeenCalledTimes(1);

  await act(async () => {
    release();
  });
});
