import React from 'react';
import { render } from '@testing-library/react-native';
import { StatusScreen } from '../StatusScreen';
import { useConnectionStore } from '../../stores/connectionStore';
import { BleConnectionState } from '../../features/bluetooth/types/BleConnectionState';

describe('StatusScreen', () => {
  beforeEach(() => {
    useConnectionStore.setState({
      bleState: BleConnectionState.DISCONNECTED,
      wsConnected: false,
      pendingPacketCount: 0,
      lastHeartbeatAt: null,
      authToken: null,
    });
  });

  it('renders correctly with default disconnected state', () => {
    const { getAllByText, getByText } = render(<StatusScreen />);
    
    expect(getByText('JabbelPin Status')).toBeTruthy();
    expect(getAllByText('DISCONNECTED').length).toBe(2);
    expect(getByText('0')).toBeTruthy();
    expect(getByText('Never')).toBeTruthy();
  });

  it('renders correctly when connected', () => {
    useConnectionStore.setState({
      bleState: BleConnectionState.CONNECTED,
      wsConnected: true,
      pendingPacketCount: 5,
      lastHeartbeatAt: 1672531200000,
    });

    const { getAllByText, getByText } = render(<StatusScreen />);
    
    expect(getAllByText('CONNECTED').length).toBe(2);
    expect(getByText('5')).toBeTruthy();
    expect(getByText(/.*:.*:.*/)).toBeTruthy(); 
  });
  
  it('handles SCANNING state', () => {
    useConnectionStore.setState({
      bleState: BleConnectionState.SCANNING,
    });
    const { getByText } = render(<StatusScreen />);
    expect(getByText('SCANNING')).toBeTruthy();
  });
});
