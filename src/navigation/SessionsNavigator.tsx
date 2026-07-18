import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SessionListScreen } from '../screens/Sessions/SessionListScreen';
import { SessionDetailScreen } from '../screens/Sessions/SessionDetailScreen';

const Stack = createNativeStackNavigator();

export function SessionsNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0A0A0A' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
        contentStyle: { backgroundColor: '#000' },
      }}
    >
      <Stack.Screen 
        name="SessionList" 
        component={SessionListScreen} 
        options={{ title: 'Audio Sessions' }} 
      />
      <Stack.Screen 
        name="SessionDetail" 
        component={SessionDetailScreen} 
        options={{ title: 'Transcript' }} 
      />
    </Stack.Navigator>
  );
}
