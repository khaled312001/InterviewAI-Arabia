import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../store/auth';
import { useAppTheme } from '../theme/useTheme';

import { OnboardingScreen } from '../screens/OnboardingScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { SignUpScreen } from '../screens/SignUpScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';

import { HomeScreen } from '../screens/HomeScreen';
import { CategoryDetailsScreen } from '../screens/CategoryDetailsScreen';
import { InterviewScreen } from '../screens/InterviewScreen';
import { FeedbackScreen } from '../screens/FeedbackScreen';
import { SessionSummaryScreen } from '../screens/SessionSummaryScreen';

import { HistoryScreen } from '../screens/HistoryScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SubscriptionScreen } from '../screens/SubscriptionScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
  Main: undefined;
  CategoryDetails: { categoryId: number; nameAr: string; nameEn: string };
  Interview: { sessionId: string; firstQuestion: any; category: any };
  Feedback: { answerId: string; feedback: any; tokensUsed: number; nextQuestion: any; sessionId: string };
  SessionSummary: { sessionId: string };
  Subscription: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator();

function MainTabs() {
  const theme = useAppTheme();
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          paddingTop: 4, paddingBottom: 6, height: 62,
        },
        tabBarLabelStyle: { fontFamily: theme.typography.fontFamily, fontSize: 12 },
        tabBarIcon: ({ color, size }) => {
          const map: Record<string, any> = {
            Home: 'home', History: 'time', Stats: 'stats-chart', Profile: 'person',
          };
          return <Ionicons name={map[route.name] || 'ellipse'} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="Home" component={HomeScreen} options={{ title: 'الرئيسية' }} />
      <Tabs.Screen name="History" component={HistoryScreen} options={{ title: 'السجل' }} />
      <Tabs.Screen name="Stats" component={StatsScreen} options={{ title: 'إحصائياتي' }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ title: 'حسابي' }} />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const token = useAuth((s) => s.token);

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!token ? (
        <>
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="SignUp" component={SignUpScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        </>
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="CategoryDetails" component={CategoryDetailsScreen} options={{ headerShown: true, title: 'تفاصيل القسم' }} />
          <Stack.Screen name="Interview" component={InterviewScreen} options={{ headerShown: true, title: 'المقابلة' }} />
          <Stack.Screen name="Feedback" component={FeedbackScreen} options={{ headerShown: true, title: 'التقييم' }} />
          <Stack.Screen name="SessionSummary" component={SessionSummaryScreen} options={{ headerShown: true, title: 'ملخص الجلسة' }} />
          <Stack.Screen name="Subscription" component={SubscriptionScreen} options={{ headerShown: true, title: 'الاشتراك المميز' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: true, title: 'الإعدادات' }} />
        </>
      )}
    </Stack.Navigator>
  );
}
