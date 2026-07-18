import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  DeviceEventEmitter,
  ScrollView,
  StatusBar,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnectionStore } from '../stores/connectionStore';
import { BleConnectionState } from '../features/bluetooth/types/BleConnectionState';
import { Ionicons } from '@expo/vector-icons';

// ─── Animated Ring Indicator ─────────────────────────────────────────────────

const RingIndicator = ({ color, active, size = 120 }: { color: string; active: boolean; size?: number }) => {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      const animate = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, { toValue: 1, duration: 1800, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          ])
        ).start();
      animate(ring1, 0);
      animate(ring2, 900);
    } else {
      ring1.setValue(0);
      ring2.setValue(0);
    }
  }, [active, ring1, ring2]);

  const innerSize = size;
  const ring1Scale = ring1.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const ring2Scale = ring2.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const ring1Opacity = ring1.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.3, 0] });
  const ring2Opacity = ring2.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 0.2, 0] });

  return (
    <View style={{ width: innerSize * 2.5, height: innerSize * 2.5, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          styles.ring,
          {
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            borderColor: color,
            transform: [{ scale: ring1Scale }],
            opacity: ring1Opacity,
          },
        ]}
      />
      <Animated.View
        style={[
          styles.ring,
          {
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            borderColor: color,
            transform: [{ scale: ring2Scale }],
            opacity: ring2Opacity,
            position: 'absolute',
          },
        ]}
      />
      <View
        style={[
          styles.ringCenter,
          {
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            backgroundColor: `${color}18`,
            borderColor: `${color}50`,
          },
        ]}
      >
        <Ionicons
          name="bluetooth"
          size={innerSize * 0.38}
          color={color}
        />
      </View>
    </View>
  );
};

// ─── Pulse Dot ───────────────────────────────────────────────────────────────

const PulseDot = ({ color, active }: { color: string; active: boolean }) => {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 0.2, duration: 700, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      anim.setValue(1);
    }
  }, [active, anim]);

  return <Animated.View style={[styles.pulseDot, { backgroundColor: color, opacity: anim }]} />;
};

// ─── Stat Card ────────────────────────────────────────────────────────────────

const StatCard = ({
  icon,
  label,
  value,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number;
  accent: string;
}) => (
  <View style={[styles.statCard, { borderColor: `${accent}25` }]}>
    <View style={[styles.statIconWrap, { backgroundColor: `${accent}18` }]}>
      <Ionicons name={icon} size={18} color={accent} />
    </View>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

// ─── Connection Row ───────────────────────────────────────────────────────────

const ConnectionRow = ({
  icon,
  label,
  statusText,
  statusColor,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  statusText: string;
  statusColor: string;
  active: boolean;
}) => (
  <View style={styles.connRow}>
    <View style={[styles.connIconWrap, { backgroundColor: `${statusColor}15` }]}>
      <Ionicons name={icon} size={20} color={statusColor} />
    </View>
    <Text style={styles.connLabel}>{label}</Text>
    <View style={[styles.statusPill, { backgroundColor: `${statusColor}20`, borderColor: `${statusColor}40` }]}>
      <PulseDot color={statusColor} active={active} />
      <Text style={[styles.statusPillText, { color: statusColor }]}>{statusText}</Text>
    </View>
  </View>
);

// ─── Main Screen ─────────────────────────────────────────────────────────────

export function StatusScreen() {
  const insets = useSafeAreaInsets();
  const { bleState, wsConnected, pendingPacketCount, packetsReceived, lastHeartbeatAt } =
    useConnectionStore();

  const getBleColor = (state: BleConnectionState) => {
    switch (state) {
      case BleConnectionState.CONNECTED:    return '#10b981';
      case BleConnectionState.SCANNING:
      case BleConnectionState.CONNECTING:
      case BleConnectionState.RECONNECTING: return '#f59e0b';
      default:                              return '#ef4444';
    }
  };

  const getBleLabel = (state: BleConnectionState) => {
    switch (state) {
      case BleConnectionState.CONNECTED:    return 'Connected';
      case BleConnectionState.SCANNING:     return 'Scanning';
      case BleConnectionState.CONNECTING:   return 'Connecting';
      case BleConnectionState.RECONNECTING: return 'Reconnecting';
      default:                              return 'Disconnected';
    }
  };

  const isBleActive = bleState !== BleConnectionState.DISCONNECTED;
  const bleColor = getBleColor(bleState);

  const formatHeartbeat = (ts: number | null) => {
    if (!ts) return 'Never';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s ago`;
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor="#09090b" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.appName}>ALM Watch</Text>
            <Text style={styles.appSubtitle}>Companion Node</Text>
          </View>
          <View style={[styles.liveBadge, { borderColor: wsConnected ? '#10b98140' : '#ef444440' }]}>
            <PulseDot color={wsConnected ? '#10b981' : '#ef4444'} active={wsConnected} />
            <Text style={[styles.liveBadgeText, { color: wsConnected ? '#10b981' : '#ef4444' }]}>
              {wsConnected ? 'LIVE' : 'OFFLINE'}
            </Text>
          </View>
        </View>

        {/* BLE Ring Hero */}
        <View style={styles.heroSection}>
          <RingIndicator color={bleColor} active={isBleActive} size={100} />
          <Text style={[styles.bleStatusText, { color: bleColor }]}>{getBleLabel(bleState)}</Text>
          <Text style={styles.bleSubText}>Bluetooth LE</Text>
        </View>

        {/* Stats Row */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statsRow} contentContainerStyle={{ paddingHorizontal: 24 }}>
          <StatCard
            icon="radio-outline"
            label="Received"
            value={packetsReceived.toLocaleString()}
            accent="#3b82f6"
          />
          <StatCard
            icon="layers-outline"
            label="Pending"
            value={pendingPacketCount}
            accent={pendingPacketCount > 100 ? '#f59e0b' : '#8b5cf6'}
          />
          <StatCard
            icon="pulse-outline"
            label="Last Heartbeat"
            value={formatHeartbeat(lastHeartbeatAt)}
            accent="#10b981"
          />
        </ScrollView>

        {/* Connection Status Card */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connections</Text>
          <View style={styles.card}>
            <ConnectionRow
              icon="bluetooth"
              label="Watch (BLE)"
              statusText={getBleLabel(bleState)}
              statusColor={bleColor}
              active={isBleActive}
            />
            <View style={styles.divider} />
            <ConnectionRow
              icon="cloud-outline"
              label="Backend (WebSocket)"
              statusText={wsConnected ? 'Connected' : 'Disconnected'}
              statusColor={wsConnected ? '#10b981' : '#ef4444'}
              active={wsConnected}
            />
          </View>
        </View>

        {/* Health Sync Card */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Health Sync</Text>
          <View style={styles.card}>
            <View style={styles.healthRow}>
              <View style={[styles.connIconWrap, { backgroundColor: '#ef444418' }]}>
                <Ionicons name="heart" size={20} color="#ef4444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.connLabel}>Samsung Watch Metrics</Text>
                <Text style={styles.healthSubText}>HR · SpO₂ · Steps · Sleep — every 1 min</Text>
              </View>
              <PulseDot color={wsConnected ? '#10b981' : '#6b7280'} active={wsConnected} />
            </View>
          </View>
        </View>

        {/* Reconnect Button */}
        <TouchableOpacity
          style={styles.reconnectBtn}
          activeOpacity={0.8}
          onPress={() => DeviceEventEmitter.emit('MANUAL_RECONNECT')}
        >
          <Ionicons name="refresh" size={18} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.reconnectText}>Retry All Connections</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const CARD_BG = 'rgba(20, 27, 45, 0.85)';
const BORDER = 'rgba(255,255,255,0.08)';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  scroll: {
    flexGrow: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 8,
  },
  headerLeft: {},
  appName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f8fafc',
    letterSpacing: 0.4,
  },
  appSubtitle: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
    marginTop: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  liveBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Hero
  heroSection: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  bleStatusText: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  bleSubText: {
    fontSize: 13,
    color: '#475569',
    marginTop: 2,
    fontWeight: '500',
  },

  // Rings
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  ringCenter: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
  },

  // Stat cards
  statsRow: {
    marginBottom: 8,
  },
  statCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginRight: 12,
    minWidth: 110,
    alignItems: 'flex-start',
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Section
  section: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginHorizontal: 16,
  },

  // Connection Row
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  connIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connLabel: {
    flex: 1,
    fontSize: 15,
    color: '#cbd5e1',
    fontWeight: '500',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Health
  healthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  healthSubText: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
    fontWeight: '400',
  },

  // Pulse dot
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Reconnect button
  reconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 24,
    marginTop: 8,
    paddingVertical: 15,
    borderRadius: 16,
    backgroundColor: '#1d4ed8',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  reconnectText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
  },
});
