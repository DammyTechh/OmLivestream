import React from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { useTheme, isIOS } from '@/hooks/useTheme';
import { radius, space, shadow, type as typo } from '@/constants/theme';
import { Icon, type IconName } from '@/components/Icon';
import { Txt } from '@/components/ui';
import { useAuth } from '@/store/auth';

import SignInScreen     from '@/screens/SignInScreen';
import OverviewScreen   from '@/screens/OverviewScreen';
import GoLiveScreen     from '@/screens/GoLiveScreen';
import StreamsScreen    from '@/screens/StreamsScreen';
import PlatformsScreen  from '@/screens/PlatformsScreen';
import SettingsScreen   from '@/screens/SettingsScreen';
import LiveScreen       from '@/screens/LiveScreen';
import RecordingsScreen from '@/screens/RecordingsScreen';

export type RootStackParams = {
  SignIn: undefined;
  Tabs: undefined;
  Live: { streamId: string };
  Recordings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParams>();
const Tab = createBottomTabNavigator();

/**
 * A custom tab bar rather than the default.
 *
 * The default bar is a solid strip pinned to the bottom edge. What modern iOS
 * does — and what this does — is float a rounded material above the content,
 * inset from the edges and sitting clear of the home indicator. Content
 * scrolls beneath it and stays faintly visible through the blur, which is what
 * makes the screen feel deep rather than stacked.
 *
 * Labels are kept. Icon-only bars look cleaner in a screenshot and cost real
 * usability: nobody should have to learn a glyph to find their recordings.
 */
function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { t, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.tabWrap,
        // Sit above the home indicator on devices that have one, and keep a
        // sensible margin on those that don't.
        { bottom: Math.max(insets.bottom, space.md) },
      ]}
      pointerEvents="box-none"
    >
      <View style={[styles.tabBar, shadow(2), { backgroundColor: isIOS ? 'transparent' : t.surface, borderColor: t.border }]}>
        {isIOS && (
          <BlurView
            intensity={80}
            tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
            style={[StyleSheet.absoluteFill, { borderRadius: radius['2xl'] }]}
          />
        )}

        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const iconName = (options as { tabBarIcon?: unknown; iconName?: IconName }).iconName ?? 'home';
          const label = options.title ?? route.name;

          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (focused || event.defaultPrevented) return;
                if (isIOS) void Haptics.selectionAsync();
                navigation.navigate(route.name);
              }}
              // Long-press pops back to the tab's root — the shortcut people
              // expect from native tab bars.
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={styles.tabItem}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
            >
              <Icon name={iconName} size={22} color={focused ? t.primary : t.textMuted} />
              <Txt
                variant="caption"
                color={focused ? t.primary : t.textMuted}
                numberOfLines={1}
                style={{ textTransform: 'none' }}
              >
                {label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
    >
      <Tab.Screen name="Overview"  component={OverviewScreen}  options={{ title: 'Home',    iconName: 'home' } as never} />
      <Tab.Screen name="Streams"   component={StreamsScreen}   options={{ title: 'Streams', iconName: 'video' } as never} />
      <Tab.Screen name="GoLive"    component={GoLiveScreen}    options={{ title: 'Go Live', iconName: 'broadcast' } as never} />
      <Tab.Screen name="Platforms" component={PlatformsScreen} options={{ title: 'Platforms', iconName: 'link' } as never} />
      <Tab.Screen name="Settings"  component={SettingsScreen}  options={{ title: 'Settings', iconName: 'settings' } as never} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { t, isDark } = useTheme();
  const user = useAuth((s) => s.user);

  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      background: t.bg,
      card: t.surface,
      text: t.text,
      border: t.border,
      primary: t.primary,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
        {user ? (
          <>
            <Stack.Screen name="Tabs" component={Tabs} />
            {/* The live screen is a full-screen modal, not a tab. Going live is
                a mode, and offering a tab bar mid-broadcast invites the one tap
                that ends it by accident. */}
            <Stack.Screen
              name="Live"
              component={LiveScreen}
              options={{
                presentation: 'fullScreenModal',
                animation: Platform.OS === 'ios' ? 'slide_from_bottom' : 'fade',
                gestureEnabled: false, // no swipe-to-dismiss while broadcasting
              }}
            />
            <Stack.Screen
              name="Recordings"
              component={RecordingsScreen}
              options={{ presentation: 'card', animation: 'slide_from_right' }}
            />
          </>
        ) : (
          <Stack.Screen name="SignIn" component={SignInScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  tabBar: {
    flexDirection: 'row',
    borderRadius: radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    // Capped so the bar does not stretch edge-to-edge on a tablet.
    width: '92%',
    maxWidth: 520,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 4 },
});
