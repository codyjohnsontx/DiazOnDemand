import { isClerkAPIResponseError, useSignIn } from '@clerk/clerk-expo';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const colors = {
  background: '#08090b',
  surface: 'rgba(8, 9, 11, 0.94)',
  line: 'rgba(255,255,255,0.16)',
  text: '#f3f0e8',
  muted: '#b4b7bd',
  accent: '#c44a2d',
  accentPressed: '#a63c24',
  danger: '#f28b82',
};

export function SignInScreen() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  const entrance = useRef(new Animated.Value(0)).current;
  const stepEntrance = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      duration: 500,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  useEffect(() => {
    stepEntrance.setValue(0);
    Animated.timing(stepEntrance, {
      duration: 220,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [step, stepEntrance]);

  async function requestCode() {
    if (!isLoaded || !email.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const attempt = await signIn.create({ identifier: email.trim().toLowerCase() });
      const emailFactor = attempt.supportedFirstFactors?.find(
        (factor) => factor.strategy === 'email_code',
      );

      if (!emailFactor || !('emailAddressId' in emailFactor)) {
        throw new Error('Email verification is not available for this account.');
      }

      await attempt.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId: emailFactor.emailAddressId,
      });
      setStep('code');
    } catch (requestError) {
      setError(readAuthError(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode() {
    if (!isLoaded || !code.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: 'email_code',
        code: code.trim(),
      });

      if (attempt.status !== 'complete' || !attempt.createdSessionId) {
        throw new Error('Additional verification is required for this account.');
      }

      await setActive({ session: attempt.createdSessionId });
    } catch (verifyError) {
      setError(readAuthError(verifyError));
    } finally {
      setSubmitting(false);
    }
  }

  const isEmailStep = step === 'email';
  const actionDisabled = submitting || (isEmailStep ? !email.trim() : !code.trim());
  const formAnimation = {
    opacity: stepEntrance,
    transform: [
      {
        translateY: stepEntrance.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ImageBackground
        accessibilityIgnoresInvertColors
        resizeMode="cover"
        source={require('../assets/bjj.jpg')}
        style={styles.backgroundImage}
      >
        <View style={styles.photoOverlay} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View
              style={[
                styles.content,
                {
                  opacity: entrance,
                  transform: [
                    {
                      translateY: entrance.interpolate({
                        inputRange: [0, 1],
                        outputRange: [16, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.brandRow}>
                <Image
                  accessibilityIgnoresInvertColors
                  source={require('../assets/diaz-logo.png')}
                  style={styles.logo}
                />
                <View>
                  <Text style={styles.brandName}>DIAZ MARTIAL ARTS</Text>
                  <Text style={styles.brandDetail}>MEMBER VIDEO LIBRARY</Text>
                </View>
              </View>

              <View style={styles.formBlock}>
                <View style={styles.accentRule} />
                <Text style={styles.title}>
                  {isEmailStep ? 'Welcome back.' : 'Check your email.'}
                </Text>
                <Text style={styles.description}>
                  {isEmailStep
                    ? 'Use the email attached to your adult Diaz account.'
                    : `Enter the one-time code sent to ${email.trim()}.`}
                </Text>

                <Animated.View style={[styles.form, formAnimation]}>
                  <Text style={styles.label}>
                    {isEmailStep ? 'Email address' : 'Verification code'}
                  </Text>
                  <TextInput
                    autoCapitalize="none"
                    autoComplete={isEmailStep ? 'email' : 'one-time-code'}
                    autoCorrect={false}
                    autoFocus={!isEmailStep}
                    editable={!submitting}
                    inputMode={isEmailStep ? 'email' : 'numeric'}
                    key={step}
                    keyboardType={isEmailStep ? 'email-address' : 'number-pad'}
                    maxLength={isEmailStep ? undefined : 8}
                    onBlur={() => setFieldFocused(false)}
                    onChangeText={isEmailStep ? setEmail : setCode}
                    onFocus={() => setFieldFocused(true)}
                    onSubmitEditing={() => void (isEmailStep ? requestCode() : verifyCode())}
                    placeholder={isEmailStep ? 'you@example.com' : 'Enter your code'}
                    placeholderTextColor="#747981"
                    returnKeyType="done"
                    selectionColor={colors.accent}
                    style={[styles.input, fieldFocused ? styles.inputFocused : null]}
                    textContentType={isEmailStep ? 'emailAddress' : 'oneTimeCode'}
                    value={isEmailStep ? email : code}
                  />

                  {error ? (
                    <Text accessibilityLiveRegion="polite" style={styles.error}>
                      {error}
                    </Text>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    disabled={actionDisabled}
                    onPress={() => void (isEmailStep ? requestCode() : verifyCode())}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      pressed && !actionDisabled ? styles.primaryButtonPressed : null,
                      actionDisabled ? styles.primaryButtonDisabled : null,
                    ]}
                  >
                    {submitting ? (
                      <ActivityIndicator color={colors.text} />
                    ) : (
                      <Text style={styles.primaryButtonText}>
                        {isEmailStep ? 'Send sign-in code' : 'Verify and continue'}
                      </Text>
                    )}
                  </Pressable>

                  {!isEmailStep && !submitting ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setCode('');
                        setError(null);
                        setStep('email');
                      }}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryButtonText}>Use a different email</Text>
                    </Pressable>
                  ) : null}
                </Animated.View>

                <Text style={styles.footer}>
                  Adult account holders only. Membership purchases are not available in this app.
                </Text>
              </View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </ImageBackground>
    </SafeAreaView>
  );
}

function readAuthError(error: unknown) {
  if (isClerkAPIResponseError(error)) {
    return error.errors[0]?.longMessage ?? error.errors[0]?.message ?? 'Unable to sign in.';
  }

  return error instanceof Error ? error.message : 'Unable to sign in.';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  backgroundImage: { flex: 1 },
  photoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 7, 10, 0.58)',
  },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, justifyContent: 'space-between', minHeight: 620, paddingTop: 26 },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 13,
    paddingHorizontal: 24,
  },
  logo: { height: 74, width: 74 },
  brandName: { color: colors.text, fontSize: 16, fontWeight: '900', letterSpacing: 1.1 },
  brandDetail: {
    color: '#d6d8dc',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginTop: 4,
  },
  formBlock: {
    backgroundColor: colors.surface,
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 22,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  accentRule: { backgroundColor: colors.accent, height: 3, marginBottom: 18, width: 36 },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
  description: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 8, maxWidth: 350 },
  form: { gap: 12, marginTop: 24 },
  label: { color: colors.text, fontSize: 13, fontWeight: '700' },
  input: {
    backgroundColor: '#111419',
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  inputFocused: { borderColor: colors.accent },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
  },
  primaryButtonPressed: { backgroundColor: colors.accentPressed, transform: [{ scale: 0.99 }] },
  primaryButtonDisabled: { opacity: 0.46 },
  primaryButtonText: { color: colors.text, fontSize: 15, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  secondaryButtonText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  footer: { color: '#858a92', fontSize: 11, lineHeight: 17, marginTop: 22 },
});
