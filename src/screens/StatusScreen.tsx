import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated,
  TouchableOpacity, DeviceEventEmitter,
  ScrollView, StatusBar, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnectionStore, PttPacketLog, FastLaneStage } from '../stores/connectionStore';
import { BleConnectionState } from '../features/bluetooth/types/BleConnectionState';
import { Ionicons } from '@expo/vector-icons';

// ─── Theme ────────────────────────────────────────────────────────────────────

const C = {
  bg: '#09090b',
  surface: 'rgba(18, 24, 38, 0.95)',
  border: 'rgba(255,255,255,0.06)',
  muted: '#475569',
  text: '#f1f5f9',
  subtext: '#64748b',
  blue: '#3b82f6',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#8b5cf6',
  cyan: '#00e5ff',
};

// ─── Stage config (ChatGPT-style) ─────────────────────────────────────────────

const STAGES: Record<FastLaneStage, { label: string; sub: string; color: string; icon: string }> = {
  idle:       { label: 'Standby',    sub: 'Waiting for push-to-talk',           color: C.muted,   icon: 'radio-outline' },
  listening:  { label: 'Listening',  sub: 'Capturing audio from Watch…',        color: C.cyan,    icon: 'mic' },
  uploading:  { label: 'Uploading',  sub: 'Sending audio to backend…',          color: C.blue,    icon: 'cloud-upload-outline' },
  processing: { label: 'Thinking',   sub: 'Transcribing and recalling memory…', color: C.purple,  icon: 'sparkles-outline' },
  answering:  { label: 'Answering',  sub: 'Generating response…',              color: C.amber,   icon: 'chatbubble-ellipses-outline' },
  done:       { label: 'Done',       sub: 'Response delivered',                 color: C.green,   icon: 'checkmark-circle-outline' },
  error:      { label: 'Error',      sub: 'Something went wrong',               color: C.red,     icon: 'alert-circle-outline' },
};

// ─── Animated Pulse Dot ───────────────────────────────────────────────────────

const PulseDot = ({ color, active }: { color: string; active: boolean }) => {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 0.15, duration: 700, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      anim.stopAnimation();
      anim.setValue(1);
    }
  }, [active]);
  return <Animated.View style={[styles.pulseDot, { backgroundColor: color, opacity: anim }]} />;
};

// ─── FastLane Stage Panel (ChatGPT-style) ─────────────────────────────────────

const ACTIVE_STAGES: FastLaneStage[] = ['listening', 'uploading', 'processing', 'answering'];
const STAGE_ORDER: FastLaneStage[] = ['listening', 'uploading', 'processing', 'answering', 'done'];

const StageRow = ({ stage, currentStage }: { stage: FastLaneStage; currentStage: FastLaneStage }) => {
  const cfg = STAGES[stage];
  const currentIdx = STAGE_ORDER.indexOf(currentStage);
  const stageIdx = STAGE_ORDER.indexOf(stage);
  const isActive = stage === currentStage;
  const isDone = currentIdx > stageIdx && currentStage !== 'idle' && currentStage !== 'error';
  const isPending = !isActive && !isDone;

  const dotScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dotScale, { toValue: 1.4, duration: 500, useNativeDriver: true }),
          Animated.timing(dotScale, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();
    } else {
      dotScale.stopAnimation();
      dotScale.setValue(1);
    }
  }, [isActive]);

  const color = isDone ? C.green : isActive ? cfg.color : C.muted;
  const iconName = isDone ? 'checkmark-circle' : (cfg.icon as any);

  return (
    <View style={styles.stageRow}>
      <Animated.View style={[styles.stageDotWrap, { transform: [{ scale: isActive ? dotScale : 1 }] }]}>
        <View style={[styles.stageDot, { backgroundColor: color + (isPending ? '30' : '22'), borderColor: color + (isPending ? '40' : 'aa') }]}>
          <Ionicons name={iconName} size={14} color={isPending ? C.muted : color} />
        </View>
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.stageLabel, { color: isPending ? C.muted : color, fontWeight: isActive ? '700' : '500' }]}>
          {cfg.label}
          {isActive && <Text style={styles.stageDots}> ···</Text>}
        </Text>
        {isActive && <Text style={[styles.stageSub, { color }]}>{cfg.sub}</Text>}
      </View>
      {isDone && <Ionicons name="checkmark" size={14} color={C.green} />}
    </View>
  );
};

const FastLanePanel = () => {
  const { fastLaneStage, fastLaneError, assistantMessage, assistantPrompt, setFastLaneStage, setFastLaneActive, setAssistantMessage, setAssistantPrompt } = useConnectionStore();

  const handleClear = () => {
    setFastLaneStage('idle');
    setFastLaneActive(false);
    setAssistantMessage(null);
    setAssistantPrompt(null);
  };
  const cfg = STAGES[fastLaneStage];
  const isActive = ACTIVE_STAGES.includes(fastLaneStage);
  const isDone = fastLaneStage === 'done';
  const isError = fastLaneStage === 'error';
  const isIdle = fastLaneStage === 'idle';

  const glowAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0, duration: 1200, useNativeDriver: true }),
        ])
      ).start();
    } else {
      glowAnim.stopAnimation();
      glowAnim.setValue(0);
    }
  }, [isActive]);

  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.22] });

  return (
    <View style={[styles.card, styles.fastLaneCard, { borderColor: isIdle ? C.border : cfg.color + '40' }]}>
      {/* Animated glow bg */}
      {isActive && (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: cfg.color, opacity: glowOpacity, borderRadius: 18 }]} />
      )}

      {/* Header */}
      <View style={styles.fastLaneHeader}>
        <View style={[styles.fastLaneIconWrap, { backgroundColor: cfg.color + '20' }]}>
          <Ionicons name={cfg.icon as any} size={20} color={isIdle ? C.muted : cfg.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.fastLaneTitle, { color: isIdle ? C.muted : cfg.color }]}>
            Fast Lane {isIdle ? '' : '· ' + cfg.label}
          </Text>
          <Text style={styles.fastLaneSub}>Push-to-talk pipeline</Text>
        </View>
        {isActive && <PulseDot color={cfg.color} active />}
        {!isIdle && (
          <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
            <Ionicons name="close-circle" size={24} color={C.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Stage steps (show only when active or done) */}
      {!isIdle && !isError && (
        <View style={styles.stageList}>
          {STAGE_ORDER.filter(s => s !== 'done').map(s => (
            <StageRow key={s} stage={s} currentStage={fastLaneStage} />
          ))}
        </View>
      )}

      {/* Error */}
      {isError && (
        <View style={styles.stageErrorBox}>
          <Ionicons name="alert-circle-outline" size={18} color={C.red} />
          <Text style={styles.stageErrorText}>{fastLaneError || 'Pipeline error'}</Text>
        </View>
      )}

      {/* Answer box */}
      {(isDone || assistantMessage) && assistantMessage ? (
        <View style={styles.answerBox}>
          <View style={styles.answerBoxHeader}>
            <Ionicons name="sparkles" size={14} color={C.purple} />
            <Text style={styles.answerBoxTag}>Assistant</Text>
          </View>
          {assistantPrompt && (
            <View style={styles.promptBox}>
              <Text style={styles.promptLabel}>Prompt Sent to LLM:</Text>
              <Text style={styles.promptText}>{assistantPrompt}</Text>
            </View>
          )}
          <Text style={styles.answerText}>{assistantMessage}</Text>
        </View>
      ) : isIdle ? (
        <Text style={styles.idleHint}>Press PTT on the Watch to start</Text>
      ) : null}
    </View>
  );
};

// ─── Stat Card ────────────────────────────────────────────────────────────────

const StatCard = ({ icon, label, value, accent, warn }: {
  icon: keyof typeof Ionicons.glyphMap; label: string;
  value: string | number; accent: string; warn?: boolean;
}) => (
  <View style={[styles.statCard, { borderColor: warn ? C.red + '40' : accent + '28' }]}>
    <View style={[styles.statIconWrap, { backgroundColor: (warn ? C.red : accent) + '18' }]}>
      <Ionicons name={icon} size={18} color={warn ? C.red : accent} />
    </View>
    <Text style={[styles.statValue, { color: warn ? C.red : C.text }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

// ─── Connection Pill ──────────────────────────────────────────────────────────

const ConnRow = ({ icon, label, statusText, color, active }: {
  icon: keyof typeof Ionicons.glyphMap; label: string;
  statusText: string; color: string; active: boolean;
}) => (
  <View style={styles.connRow}>
    <View style={[styles.connIcon, { backgroundColor: color + '15' }]}>
      <Ionicons name={icon} size={19} color={color} />
    </View>
    <Text style={styles.connLabel}>{label}</Text>
    <View style={[styles.statusPill, { backgroundColor: color + '18', borderColor: color + '38' }]}>
      <PulseDot color={color} active={active} />
      <Text style={[styles.statusPillText, { color }]}>{statusText}</Text>
    </View>
  </View>
);

// ─── PTT Packet Row ───────────────────────────────────────────────────────────

const PttRow = ({ item }: { item: PttPacketLog }) => {
  const isSent   = item.direction === 'sent';
  const isError  = item.status === 'error';
  const accent   = isError ? C.red : isSent ? C.green : C.blue;
  const icon: keyof typeof Ionicons.glyphMap = isError
    ? 'close-circle-outline'
    : isSent ? 'cloud-upload-outline' : 'radio-outline';
  const label    = isError
    ? (isSent ? 'Upload failed' : 'Receive error')
    : isSent
    ? `Sent to backend${item.byteSize ? ` · ${item.byteSize}B` : ''}`
    : `Watch → Phone${item.byteSize ? ` · ${item.byteSize}B` : ''}`;

  const t = new Date(item.timestamp);
  const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;

  return (
    <View style={[styles.pttRow, isSent && styles.pttRowSent]}>
      <View style={[styles.pttIcon, { backgroundColor: accent + '18' }]}>
        <Ionicons name={icon} size={14} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.pttLabel, { color: isError ? C.red : isSent ? '#a7f3d0' : '#93c5fd' }]}>
          {label}
        </Text>
        {item.packetId && <Text style={styles.pttId} numberOfLines={1}>{item.packetId}</Text>}
      </View>
      <Text style={styles.pttTime}>{ts}</Text>
    </View>
  );
};

// ─── BLE Ring ─────────────────────────────────────────────────────────────────

const BleRing = ({ color, active }: { color: string; active: boolean }) => {
  const r1 = useRef(new Animated.Value(0)).current;
  const r2 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (active) {
      const anim = (v: Animated.Value, delay: number) =>
        Animated.loop(Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 1800, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])).start();
      anim(r1, 0); anim(r2, 900);
    } else { r1.setValue(0); r2.setValue(0); }
  }, [active]);

  const S = 90;
  const mkScale = (v: Animated.Value, max: number) => v.interpolate({ inputRange: [0,1], outputRange: [1, max] });
  const mkOpacity = (v: Animated.Value) => v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 0.2, 0] });

  return (
    <View style={{ width: S * 2.8, height: S * 2.8, alignItems: 'center', justifyContent: 'center' }}>
      {[r1, r2].map((v, i) => (
        <Animated.View key={i} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Animated.View style={{ width: S, height: S, borderRadius: S/2, borderWidth: 1.5, borderColor: color, transform: [{ scale: mkScale(v, i === 0 ? 1.9 : 2.5) }], opacity: mkOpacity(v) }} />
        </Animated.View>
      ))}
      <View style={[styles.ringCenter, { width: S, height: S, borderRadius: S/2, backgroundColor: color+'12', borderColor: color+'40' }]}>
        <Ionicons name="bluetooth" size={S * 0.36} color={color} />
      </View>
    </View>
  );
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export function StatusScreen() {
  const insets = useSafeAreaInsets();
  const {
    bleState, wsConnected, pendingPacketCount,
    packetsReceived, packetsSent, pttLog, clearPttLog,
    fastLaneStage,
  } = useConnectionStore();

  const getBleColor = (s: BleConnectionState) => {
    switch (s) {
      case BleConnectionState.CONNECTED:    return C.green;
      case BleConnectionState.SCANNING:
      case BleConnectionState.CONNECTING:
      case BleConnectionState.RECONNECTING: return C.amber;
      default:                              return C.red;
    }
  };
  const getBleLabel = (s: BleConnectionState) => {
    switch (s) {
      case BleConnectionState.CONNECTED:    return 'Connected';
      case BleConnectionState.SCANNING:     return 'Scanning';
      case BleConnectionState.CONNECTING:   return 'Connecting';
      case BleConnectionState.RECONNECTING: return 'Reconnecting';
      default:                              return 'Disconnected';
    }
  };

  const bleColor = getBleColor(bleState);
  const isBleActive = bleState !== BleConnectionState.DISCONNECTED;
  const sentErrors = pttLog.filter(e => e.direction === 'sent' && e.status === 'error').length;
  const pendingHighWater = pendingPacketCount > 50;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.appName}>ALM Watch</Text>
            <Text style={styles.appSub}>Companion Node</Text>
          </View>
          <View style={[styles.liveBadge, { borderColor: wsConnected ? C.green+'40' : C.red+'40' }]}>
            <PulseDot color={wsConnected ? C.green : C.red} active={wsConnected} />
            <Text style={[styles.liveBadgeText, { color: wsConnected ? C.green : C.red }]}>
              {wsConnected ? 'LIVE' : 'OFFLINE'}
            </Text>
          </View>
        </View>

        {/* ── BLE Hero ── */}
        <View style={styles.hero}>
          <BleRing color={bleColor} active={isBleActive} />
          <Text style={[styles.bleStatus, { color: bleColor }]}>{getBleLabel(bleState)}</Text>
          <Text style={styles.bleSub}>Bluetooth LE · Watch Link</Text>
        </View>

        {/* ── Stats Row ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statsScroll} contentContainerStyle={{ paddingHorizontal: 24 }}>
          <StatCard icon="radio-outline"        label="BLE Received"   value={packetsReceived.toLocaleString()} accent={C.blue} />
          <StatCard icon="cloud-upload-outline" label="Sent to Server" value={packetsSent.toLocaleString()}     accent={C.green} warn={packetsSent === 0 && packetsReceived > 10} />
          <StatCard icon="layers-outline"       label="Queue"          value={pendingPacketCount}               accent={pendingHighWater ? C.amber : C.purple} warn={pendingHighWater} />
          {sentErrors > 0 && <StatCard icon="alert-circle-outline" label="Send Errors" value={sentErrors} accent={C.red} warn />}
        </ScrollView>

        {/* ── FastLane ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Fast Lane · PTT Pipeline</Text>
          <FastLanePanel />
        </View>

        {/* ── Connections ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connections</Text>
          <View style={styles.card}>
            <ConnRow icon="bluetooth"    label="Watch (BLE)"          statusText={getBleLabel(bleState)}                color={bleColor}                     active={isBleActive} />
            <View style={styles.divider} />
            <ConnRow icon="cloud-outline" label="Backend (WebSocket)" statusText={wsConnected ? 'Connected' : 'Offline'} color={wsConnected ? C.green : C.red} active={wsConnected} />
          </View>
        </View>

        {/* ── PTT Packet Log ── */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>PTT Packet Activity</Text>
            <View style={styles.sectionRight}>
              {pttLog.length > 0 && (
                <TouchableOpacity onPress={clearPttLog} style={styles.clearBtn}>
                  <Text style={styles.clearBtnText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: C.blue }]} /><Text style={styles.legendText}>Watch → Phone</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: C.green }]} /><Text style={styles.legendText}>Phone → Server</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: C.red }]} /><Text style={styles.legendText}>Error</Text></View>
          </View>

          <View style={[styles.card, { paddingVertical: 4 }]}>
            {pttLog.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="radio-outline" size={30} color="#1e293b" />
                <Text style={styles.emptyText}>No packets yet</Text>
                <Text style={styles.emptySub}>Activity appears here in real-time</Text>
              </View>
            ) : (
              pttLog.map(item => <PttRow key={item.id} item={item} />)
            )}
          </View>
        </View>

        {/* ── Retry ── */}
        <TouchableOpacity
          style={styles.retryBtn}
          activeOpacity={0.8}
          onPress={() => DeviceEventEmitter.emit('MANUAL_RECONNECT')}
        >
          <Ionicons name="refresh" size={18} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.retryText}>Retry All Connections</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: C.bg },
  scroll:         { flexGrow: 1 },

  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 4 },
  appName:        { fontSize: 22, fontWeight: '700', color: C.text, letterSpacing: 0.3 },
  appSub:         { fontSize: 12, color: C.muted, fontWeight: '500', marginTop: 1 },
  liveBadge:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, borderWidth: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  liveBadgeText:  { fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  hero:           { alignItems: 'center', paddingVertical: 8 },
  bleStatus:      { fontSize: 20, fontWeight: '700', marginTop: 4 },
  bleSub:         { fontSize: 12, color: C.muted, marginTop: 2 },
  ringCenter:     { justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, position: 'absolute' },

  statsScroll:    { marginBottom: 12 },
  statCard:       { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, padding: 14, marginRight: 10, minWidth: 105, alignItems: 'flex-start' },
  statIconWrap:   { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  statValue:      { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 2 },
  statLabel:      { fontSize: 10, color: C.subtext, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },

  section:        { paddingHorizontal: 24, marginBottom: 16 },
  sectionTitle:   { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  sectionRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  sectionRight:   { flex: 1, alignItems: 'flex-end' },
  card:           { backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  divider:        { height: 1, backgroundColor: C.border, marginHorizontal: 16 },

  // FastLane
  fastLaneCard:   { padding: 16 },
  fastLaneHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  fastLaneIconWrap:{ width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  fastLaneTitle:  { fontSize: 16, fontWeight: '700', letterSpacing: 0.2, marginBottom: 2 },
  fastLaneSub:    { fontSize: 13, color: C.subtext },
  clearBtn:       { padding: 4, marginLeft: 8 },
  stageList:      { gap: 2, marginBottom: 12 },
  stageRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  stageDotWrap:   { alignItems: 'center', justifyContent: 'center' },
  stageDot:       { width: 32, height: 32, borderRadius: 10, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  stageLabel:     { fontSize: 14 },
  stageDots:      { color: 'rgba(255,255,255,0.4)' },
  stageSub:       { fontSize: 11, marginTop: 2, opacity: 0.8 },
  stageErrorBox:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.red+'15', borderRadius: 10, padding: 12, marginBottom: 12 },
  stageErrorText: { fontSize: 13, color: C.red },
  answerBox:      { backgroundColor: 'rgba(139,92,246,0.1)', borderRadius: 12, borderWidth: 1, borderColor: C.purple+'30', padding: 14 },
  answerBoxHeader:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  answerBoxTag:   { fontSize: 11, color: C.purple, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  promptBox:      { backgroundColor: 'rgba(0,0,0,0.15)', padding: 10, borderRadius: 8, marginBottom: 12 },
  promptLabel:    { fontSize: 10, color: C.subtext, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  promptText:     { fontSize: 12, color: '#a1a1aa', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 18 },
  answerText:     { fontSize: 15, color: C.text, lineHeight: 24 },
  idleHint:       { fontSize: 13, color: C.muted, textAlign: 'center', paddingVertical: 8 },

  // Connections
  connRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  connIcon:       { width: 38, height: 38, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  connLabel:      { flex: 1, fontSize: 14, color: '#cbd5e1', fontWeight: '500' },
  statusPill:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1 },
  statusPillText: { fontSize: 12, fontWeight: '600' },

  // PTT log
  legend:         { flexDirection: 'row', gap: 16, marginBottom: 8 },
  legendItem:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:      { width: 8, height: 8, borderRadius: 4 },
  legendText:     { fontSize: 11, color: C.muted },
  pttRow:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, gap: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  pttRowSent:     { backgroundColor: 'rgba(16,185,129,0.03)' },
  pttIcon:        { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  pttLabel:       { fontSize: 12, fontWeight: '500' },
  pttId:          { fontSize: 10, color: C.subtext, marginTop: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  pttTime:        { fontSize: 10, color: C.subtext },
  emptyState:     { alignItems: 'center', paddingVertical: 28, gap: 4 },
  emptyText:      { fontSize: 14, color: '#334155', fontWeight: '600', marginTop: 6 },
  emptySub:       { fontSize: 12, color: '#1e293b' },

  pulseDot:       { width: 8, height: 8, borderRadius: 4 },

  retryBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginHorizontal: 24, marginTop: 8, paddingVertical: 15, borderRadius: 16, backgroundColor: '#1d4ed8', shadowColor: C.blue, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  retryText:      { fontSize: 15, fontWeight: '700', color: '#fff' },

  clearBtn:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: C.blue+'18' },
  clearBtnText:   { fontSize: 12, color: C.blue, fontWeight: '600' },
});
