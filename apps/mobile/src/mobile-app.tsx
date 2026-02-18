import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import * as Linking from 'expo-linking';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Button,
  FlatList,
  Pressable,
  SafeAreaView,
  Text,
  View,
} from 'react-native';
import type { FavoriteDto, LessonDetailDto, MeDto, ProgramWithContentDto } from '@diaz/shared';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
const DEV_USER_ID = process.env.EXPO_PUBLIC_DEV_USER_ID ?? 'dev_clerk_user';
const SUBSCRIBE_URL = process.env.EXPO_PUBLIC_SUBSCRIBE_URL ?? 'http://localhost:3000/subscribe';

type RootStackParamList = {
  Programs: undefined;
  ProgramDetail: { program: ProgramWithContentDto };
  CourseDetail: { courseId: string };
  Lesson: { lessonId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator();

let devUserId = DEV_USER_ID;

type ApiInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-dev-user-id': devUserId,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status}: ${message}`);
  }

  return response.json() as Promise<T>;
}

function ProgramsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Programs'>) {
  const [programs, setPrograms] = useState<ProgramWithContentDto[]>([]);

  useEffect(() => {
    api<ProgramWithContentDto[]>('/programs').then(setPrograms).catch(console.error);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 12 }}>Programs</Text>
      <FlatList
        data={programs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('ProgramDetail', { program: item })}>
            <View style={{ padding: 12, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.title}</Text>
              <Text style={{ color: '#666' }}>{item.courses.length} courses</Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function ProgramDetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'ProgramDetail'>) {
  const { program } = route.params;

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 12 }}>{program.title}</Text>
      <FlatList
        data={program.courses}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('CourseDetail', { courseId: item.id })}>
            <View style={{ padding: 12, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.title}</Text>
              <Text style={{ color: '#666' }}>{item.lessons?.length ?? 0} lessons</Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function CourseDetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'CourseDetail'>) {
  const { courseId } = route.params;
  const [course, setCourse] = useState<ProgramWithContentDto['courses'][number] | null>(null);

  useEffect(() => {
    api<ProgramWithContentDto['courses'][number]>(`/courses/${courseId}`).then(setCourse).catch(console.error);
  }, [courseId]);

  if (!course) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 12 }}>{course.title}</Text>
      <FlatList
        data={course.lessons ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('Lesson', { lessonId: item.id })}>
            <View style={{ padding: 12, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.title}</Text>
              <Text style={{ color: '#666' }}>{item.accessLevel}</Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function LessonScreen({ route }: NativeStackScreenProps<RootStackParamList, 'Lesson'>) {
  const { lessonId } = route.params;
  const [lesson, setLesson] = useState<LessonDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef(false);

  useEffect(() => {
    setError(null);
    api<LessonDetailDto>(`/lessons/${lessonId}`).then(setLesson).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [lessonId]);

  useEffect(() => {
    async function saveProgress() {
      if (saveInFlightRef.current) {
        pendingSaveRef.current = true;
        return;
      }

      saveInFlightRef.current = true;

      try {
        const completed = durationRef.current > 0 && durationRef.current - positionRef.current < 10;
        await api(`/progress/${lessonId}`, {
          method: 'POST',
          body: JSON.stringify({
            lastPositionSeconds: Math.max(0, Math.floor(positionRef.current)),
            completed,
          }),
        });
      } catch (saveError) {
        console.error(saveError);
      } finally {
        saveInFlightRef.current = false;

        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          void saveProgress();
        }
      }
    }

    const intervalId = setInterval(() => {
      void saveProgress();
    }, 10000);

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        void saveProgress();
      }
    });

    return () => {
      clearInterval(intervalId);
      appStateSubscription.remove();
      void saveProgress();
    };
  }, [lessonId]);

  if (error?.startsWith('402')) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: '700' }}>Premium lesson</Text>
        <Text style={{ marginTop: 8 }}>Upgrade to premium to watch this lesson.</Text>
        <Button onPress={() => Linking.openURL(SUBSCRIBE_URL)} title="Subscribe" />
      </SafeAreaView>
    );
  }

  if (!lesson) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const source = lesson.playbackUrl ?? (lesson.muxPlaybackId ? `https://stream.mux.com/${lesson.muxPlaybackId}.m3u8` : null);

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 12 }}>{lesson.title}</Text>
      {source ? (
        <Video
          style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }}
          source={{ uri: source }}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
            if (!status.isLoaded) {
              return;
            }

            positionRef.current = status.positionMillis / 1000;
            durationRef.current = status.durationMillis ? status.durationMillis / 1000 : 0;
          }}
        />
      ) : (
        <Text>No playback source configured for this lesson.</Text>
      )}
    </SafeAreaView>
  );
}

function LibraryStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Programs" component={ProgramsScreen} />
      <Stack.Screen name="ProgramDetail" component={ProgramDetailScreen} options={{ title: 'Program' }} />
      <Stack.Screen name="CourseDetail" component={CourseDetailScreen} options={{ title: 'Course' }} />
      <Stack.Screen name="Lesson" component={LessonScreen} options={{ title: 'Lesson' }} />
    </Stack.Navigator>
  );
}

function FavoritesScreen() {
  const [favorites, setFavorites] = useState<FavoriteDto[]>([]);

  useEffect(() => {
    api<FavoriteDto[]>('/favorites').then(setFavorites).catch(console.error);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 12 }}>Favorites</Text>
      {favorites.map((favorite) => (
        <View key={favorite.id} style={{ padding: 12, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
          <Text>{favorite.lesson?.title ?? 'Lesson'}</Text>
        </View>
      ))}
      {favorites.length === 0 ? <Text>No favorites yet.</Text> : null}
    </SafeAreaView>
  );
}

function AccountScreen() {
  const [me, setMe] = useState<MeDto | null>(null);

  useEffect(() => {
    api<MeDto>('/me').then(setMe).catch(console.error);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 12 }}>Account</Text>
      <Text>Role: {me?.role ?? 'Loading...'}</Text>
      <Text>Entitlement: {me?.entitlementTier ?? 'Loading...'}</Text>
      <View style={{ marginTop: 16 }}>
        <Button title="Manage Subscription" onPress={() => Linking.openURL(SUBSCRIBE_URL)} />
      </View>
    </SafeAreaView>
  );
}

function SignInScreen() {
  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 12 }}>Sign In</Text>
      <Text>Clerk can be enabled via EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY.</Text>
      <Text style={{ marginTop: 8 }}>MVP dev mode uses x-dev-user-id header:</Text>
      <Text>Current dev user header:</Text>
      <Text style={{ marginTop: 8, fontWeight: '600' }}>{devUserId}</Text>
      <View style={{ marginTop: 16 }}>
        <Button
          title="Reset to default"
          onPress={() => {
            devUserId = DEV_USER_ID;
          }}
        />
      </View>
    </SafeAreaView>
  );
}

export function MobileApp() {
  return (
    <NavigationContainer>
      <Tabs.Navigator>
        <Tabs.Screen name="Library" component={LibraryStack} options={{ headerShown: false }} />
        <Tabs.Screen name="Favorites" component={FavoritesScreen} />
        <Tabs.Screen name="Account" component={AccountScreen} />
        <Tabs.Screen name="SignIn" component={SignInScreen} options={{ title: 'Sign In' }} />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
