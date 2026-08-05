import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Activity, Clock, FileAudio, Bot } from 'lucide-react-native';

import { StatusScreen } from '../screens/StatusScreen';
import { SessionsNavigator } from './SessionsNavigator';
import { HealthScreen } from '../screens/Health/HealthScreen';
import { AssistantScreen } from '../screens/Assistant/AssistantScreen';

const Tab = createBottomTabNavigator();

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#0A0A0A',
            borderTopColor: '#222',
            paddingBottom: 5,
            paddingTop: 5,
            height: 60,
          },
          tabBarActiveTintColor: '#00F0FF',
          tabBarInactiveTintColor: '#666',
        }}
      >
        <Tab.Screen
          name="Status"
          component={StatusScreen}
          options={{
            tabBarIcon: ({ color, size }) => <Activity color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Assistant"
          component={AssistantScreen}
          options={{
            tabBarIcon: ({ color, size }) => <Bot color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Sessions"
          component={SessionsNavigator}
          options={{
            tabBarIcon: ({ color, size }) => <FileAudio color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Health"
          component={HealthScreen}
          options={{
            tabBarIcon: ({ color, size }) => <Clock color={color} size={size} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

