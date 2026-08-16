import { StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth';
import { useAppTheme } from '../theme/useTheme';

import { OnboardingScreen } from '../screens/OnboardingScreen';
import { MeetingScreen } from '../screens/MeetingScreen';
import { MeetingSetupScreen } from '../screens/MeetingSetupScreen';
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
  Settings: undefined;
  MeetingSetup: { categoryId?: number } | undefined;
  /** `language` is the interview language chosen on the setup screen — it
   *  drives the questions, the voice, the recogniser locale and the
   *  evaluation, so it travels with the route rather than reading the UI
   *  language at call time. */
  Meeting: { categoryId: number; categoryName: string; language?: 'ar' | 'en'; context?: any };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator();

function MainTabs() {
  const theme = useAppTheme();
  const { t } = useTranslation();
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingTop: 8,
          paddingBottom: 10,
          height: 68,
        },
        tabBarLabelStyle: {
          fontFamily: theme.typography.fontFamilyBold,
          fontSize: 11,
          marginTop: 2,
        },
        tabBarIcon: ({ color, focused }) => {
          const map: Record<string, { filled: any; outlined: any }> = {
            Home: { filled: 'home', outlined: 'home-outline' },
            History: { filled: 'time', outlined: 'time-outline' },
            Stats: { filled: 'stats-chart', outlined: 'stats-chart-outline' },
            Profile: { filled: 'person', outlined: 'person-outline' },
          };
          const pair = map[route.name] || { filled: 'ellipse', outlined: 'ellipse-outline' };
          return <Ionicons name={focused ? pair.filled : pair.outlined} size={22} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="Home" component={HomeScreen} options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="History" component={HistoryScreen} options={{ title: t('tabs.history') }} />
      <Tabs.Screen name="Stats" component={StatsScreen} options={{ title: t('tabs.stats') }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ title: t('tabs.profile') }} />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const token = useAuth((s) => s.token);
  const theme = useAppTheme();
  const { t } = useTranslation();

  /**
   * Stack headers were previously unstyled, so they rendered with the
   * platform default — a white bar sitting above a dark screen in dark mode.
   * Titles were also hardcoded Arabic, which left them untranslated in
   * English. Both come from the theme and i18n now.
   */
  // `headerTitleStyle` accepts only fontFamily/fontSize/fontWeight/color, so
  // the full TextStyle from the scale is narrowed rather than spread whole.
  const titleStyle = theme.text('h4', 'bold');
  const headerOptions = {
    headerShown: true,
    headerStyle: { backgroundColor: theme.colors.bg },
    headerTintColor: theme.colors.text,
    headerTitleStyle: {
      fontFamily: titleStyle.fontFamily,
      fontSize: titleStyle.fontSize,
      color: theme.colors.text,
    },
    headerShadowVisible: false,
    headerBackTitleVisible: false,
  } as const;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}>
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
          <Stack.Screen name="CategoryDetails" component={CategoryDetailsScreen} options={{ ...headerOptions, title: t('category.title') }} />
          <Stack.Screen name="Interview" component={InterviewScreen} options={{ ...headerOptions, title: t('interview.title') }} />
          <Stack.Screen name="Feedback" component={FeedbackScreen} options={{ ...headerOptions, title: t('feedback.title') }} />
          <Stack.Screen name="SessionSummary" component={SessionSummaryScreen} options={{ ...headerOptions, title: t('summary.title') }} />
          <Stack.Screen name="Subscription" component={SubscriptionScreen} options={{ ...headerOptions, title: t('subscription.title') }} />
          <Stack.Screen name="MeetingSetup" component={MeetingSetupScreen} options={{ ...headerOptions, title: t('meeting.setupTitle') }} />
          <Stack.Screen name="Meeting" component={MeetingScreen} options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ ...headerOptions, title: t('settings.title') }} />
        </>
      )}
    </Stack.Navigator>
  );
}
