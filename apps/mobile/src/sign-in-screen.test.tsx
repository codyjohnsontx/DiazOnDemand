/**
 * Regression tests for the two sign-in security properties closed in PR #17 and
 * recorded in the Security Invariants section of AGENTS.md. The enumeration
 * defect regressed once inside that PR - closed at the email step, then reachable
 * again through "Use a different email" - so all three paths are pinned here.
 *
 * `@clerk/clerk-expo` is mocked rather than loaded: the real package pulls in
 * clerk-js, which Babel has to transform in full and which turns a unit test into
 * a multi-minute one. The mock keeps the two things the screen actually depends
 * on - the `useSignIn` shape and the `clerkError` marker that
 * `isClerkAPIResponseError` tests for - so "Clerk answered" and "Clerk never
 * answered" stay distinguishable exactly as they are in the app.
 */
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
// Babel hoists the `jest.mock` calls below above this import, so the screen is
// loaded against them.
import { SignInScreen } from './sign-in-screen';

// jest.mock is hoisted above these, so the names have to start with `mock`.
const mockSignIn = {
  create: jest.fn(),
  attemptFirstFactor: jest.fn(),
};
const mockSetActive = jest.fn();

jest.mock('@clerk/clerk-expo', () => ({
  useSignIn: () => ({ isLoaded: true, signIn: mockSignIn, setActive: mockSetActive }),
  // The real guard reports whether the error came from the Clerk API at all; it
  // keys off the `clerkError` marker every ClerkAPIResponseError carries.
  isClerkAPIResponseError: (error: unknown) =>
    typeof error === 'object' && error !== null && 'clerkError' in error,
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

/** The shape Clerk answers an unknown identifier with. */
function clerkAnswer(code: string, message: string) {
  return Object.assign(new Error(message), {
    clerkError: true,
    status: 422,
    errors: [{ code, message, longMessage: message }],
  });
}

const unknownIdentifier = "Couldn't find your account.";

function memberAttempt() {
  return {
    supportedFirstFactors: [{ strategy: 'email_code', emailAddressId: 'idn_member' }],
    prepareFirstFactor: jest.fn().mockResolvedValue(undefined),
  };
}

function visibleText(tree: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null || node === false) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk((node as { children?: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join('\n');
}

function instanceText(instance: ReactTestInstance): string {
  return instance
    .findAll(() => true)
    .flatMap((node) => [node.props.children])
    .filter((child): child is string => typeof child === 'string')
    .join(' ');
}

// Components are matched on the props the screen gives them rather than on an
// imported type: React Native wraps Pressable and TextInput, so the rendered
// instance is not the exported component.
function buttonLabelled(root: ReactTestInstance, label: string): ReactTestInstance {
  const match = root
    .findAll((node) => typeof node.props.onPress === 'function')
    .find((button) => instanceText(button).includes(label));

  if (!match) {
    throw new Error(`no button labelled "${label}"`);
  }

  return match;
}

function field(root: ReactTestInstance): ReactTestInstance {
  const [input] = root.findAll((node) => typeof node.props.onChangeText === 'function');

  if (!input) {
    throw new Error('no text field on screen');
  }

  return input;
}

async function type(tree: ReactTestRenderer, value: string) {
  await act(async () => {
    field(tree.root).props.onChangeText(value);
  });
}

async function press(tree: ReactTestRenderer, label: string) {
  await act(async () => {
    buttonLabelled(tree.root, label).props.onPress();
  });
}

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<SignInScreen />);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the email step never says whether an address belongs to a member', () => {
  it('lands an unknown address on the same screen a member reaches', async () => {
    mockSignIn.create.mockResolvedValueOnce(memberAttempt());
    const member = await render();
    await type(member, 'member@diazmartialarts.com');
    await press(member, 'Send sign-in code');

    mockSignIn.create.mockRejectedValueOnce(
      clerkAnswer('form_identifier_not_found', unknownIdentifier),
    );
    const stranger = await render();
    await type(stranger, 'stranger@example.com');
    await press(stranger, 'Send sign-in code');

    const withoutAddress = (text: string) =>
      text.replace(/member@diazmartialarts\.com|stranger@example\.com/g, '<address>');

    expect(visibleText(stranger)).toContain('Check your email.');
    expect(withoutAddress(visibleText(stranger))).toBe(withoutAddress(visibleText(member)));
    expect(visibleText(stranger)).not.toContain(unknownIdentifier);
  });

  it('reports a failure Clerk never answered, which cannot depend on the address', async () => {
    mockSignIn.create.mockRejectedValueOnce(new TypeError('Network request failed'));
    const tree = await render();
    await type(tree, 'member@diazmartialarts.com');
    await press(tree, 'Send sign-in code');

    expect(visibleText(tree)).toContain('Welcome back.');
    expect(visibleText(tree)).toContain('We could not reach the sign-in service.');
  });
});

// The regression. The first fix closed the email step, and the oracle came back
// through this path: an attempt prepared for the attacker's own address was still
// on the Clerk resource, so a code they already held verified against an address
// Clerk had refused - success meaning "not a member", failure meaning "a member".
it('never verifies a code against an address Clerk did not prepare', async () => {
  mockSignIn.create.mockResolvedValueOnce(memberAttempt());
  const tree = await render();
  await type(tree, 'member@diazmartialarts.com');
  await press(tree, 'Send sign-in code');

  await press(tree, 'Use a different email');
  mockSignIn.create.mockRejectedValueOnce(
    clerkAnswer('form_identifier_not_found', unknownIdentifier),
  );
  await type(tree, 'stranger@example.com');
  await press(tree, 'Send sign-in code');

  await type(tree, '424242');
  await press(tree, 'Verify and continue');

  expect(mockSignIn.attemptFirstFactor).not.toHaveBeenCalled();
  expect(mockSetActive).not.toHaveBeenCalled();
  expect(visibleText(tree)).toContain('We could not verify that code.');
});
