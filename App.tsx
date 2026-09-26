import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from './supabase';
import { APP_VERSION, UpdateNotices } from './UpdateNotices';

type Customer = {
  id: string;
  name: string;
  phone: string;
  preferredStyle: string;
  notes: string;
  createdAt: string;
};
type Visit = {
  id: string;
  customerId: string;
  date: string;
  service: string;
  memo: string;
  price: number;
  productSales: number;
  visitType: '신규' | '재방문';
  nextVisitDate?: string;
  callbackDone?: boolean;
  callbackCompletedAt?: string;
  createdAt: string;
};
type DailyNote = {
  id: string;
  date: string;
  memo: string;
  createdAt: string;
};
type AppData = { customers: Customer[]; visits: Visit[]; dailyNotes: DailyNote[] };
type Tab = 'home' | 'customers' | 'calendar' | 'callbacks' | 'stats' | 'settings';

const SETTINGS_KEY = 'my-client-book-v3-settings';
const ACCENT = '#1f6f5c';
const BG = '#f4f5f2';

const dateToIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const todayIso = () => dateToIso(new Date());
const money = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
const parseMoney = (value: string) => Number(value.replace(/[^0-9]/g, '')) || 0;
const monthKey = (iso = todayIso()) => iso.slice(0, 7);
const phoneDigits = (value: string) => value.replace(/\D/g, '').slice(0, 11);
const displayPhone = (value: string, masked = false) => {
  const digits = phoneDigits(value);
  if (digits.length === 4) return `끝번호 ${digits}`;
  if (digits.length === 10) return masked ? `${digits.slice(0, 3)}-***-${digits.slice(6)}` : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11) return masked ? `${digits.slice(0, 3)}-****-${digits.slice(7)}` : `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return digits || '연락처 미입력';
};
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); });
const cacheKey = (uid: string) => `my-client-book-v4-data-${uid}`;
const pendingKey = (uid: string) => `my-client-book-v4-pending-${uid}`;
const LEGACY_KEY = 'my-client-book-v3-data';

function migrateLegacy(raw: string): AppData {
  const parsed = JSON.parse(raw) as { customers?: Array<Partial<Customer> & { id?: string; phoneLast4?: string; revisitDays?: number }>; visits?: Array<Partial<Visit> & { customerId?: string; discount?: number }> };
  const idMap = new Map<string, string>();
  const customers = (parsed.customers ?? []).map((c) => {
    const nextId = uuid();
    if (c.id) idMap.set(c.id, nextId);
    return { id: nextId, name: c.name ?? '이름 없음', phone: phoneDigits(c.phone ?? c.phoneLast4 ?? ''), preferredStyle: c.preferredStyle ?? '', notes: c.notes ?? '', createdAt: c.createdAt ?? new Date().toISOString() };
  });
  const visits = (parsed.visits ?? []).flatMap((v) => {
    const customerId = v.customerId ? idMap.get(v.customerId) : undefined;
    if (!customerId) return [];
    return [{ id: uuid(), customerId, date: v.date ?? todayIso(), service: v.service ?? '', memo: v.memo ?? '', price: Math.max((v.price ?? 0) - (v.discount ?? 0), 0), productSales: v.productSales ?? 0, visitType: '재방문' as const, nextVisitDate: undefined, callbackDone: v.callbackDone ?? false, callbackCompletedAt: undefined, createdAt: new Date().toISOString() }];
  });
  return { customers, visits, dailyNotes: [] };
}

function normalizeData(value?: Partial<AppData> | null): AppData {
  return { customers: value?.customers ?? [], visits: value?.visits ?? [], dailyNotes: value?.dailyNotes ?? [] };
}

async function readCloud(uid: string): Promise<AppData> {
  const [{ data: customers, error: ce }, { data: visits, error: ve }, { data: notes, error: ne }] = await Promise.all([
    supabase.from('customers').select('*').eq('user_id', uid),
    supabase.from('visits').select('*').eq('user_id', uid),
    supabase.from('daily_notes').select('*').eq('user_id', uid),
  ]);
  if (ce) throw ce; if (ve) throw ve; if (ne) throw ne;
  return {
    customers: (customers ?? []).map((r) => ({ id: r.id, name: r.name, phone: phoneDigits(r.phone_last4 ?? ''), preferredStyle: r.preferred_style ?? '', notes: r.memo ?? '', createdAt: r.created_at })),
    visits: (visits ?? []).map((r) => ({ id: r.id, customerId: r.customer_id, date: r.visit_date, service: r.service ?? '', memo: r.memo ?? '', price: Number(r.beauty_sales ?? r.service_price ?? 0), productSales: Number(r.retail_sales ?? 0), visitType: r.visit_type === '신규' ? '신규' : '재방문', nextVisitDate: r.next_booking_date ?? undefined, callbackDone: r.callback_status === '연락완료', callbackCompletedAt: r.callback_completed_at ?? (r.callback_status === '연락완료' ? r.updated_at ?? r.created_at : undefined), createdAt: r.created_at })),
    dailyNotes: (notes ?? []).map((r) => ({ id: r.id, date: r.note_date, memo: r.memo ?? '', createdAt: r.created_at })),
  };
}

async function writeCloud(next: AppData, uid: string) {
  const customers = next.customers.map((c) => ({ id: c.id, user_id: uid, name: c.name, phone_last4: c.phone, preferred_style: c.preferredStyle || null, memo: c.notes || null, default_cycle: 35, created_at: c.createdAt }));
  const visits = next.visits.map((v) => ({ id: v.id, user_id: uid, customer_id: v.customerId, visit_date: v.date, visit_type: v.visitType, service: v.service, service_price: v.price, discount: 0, beauty_sales: v.price, retail_sales: v.productSales, callback_cycle: 35, callback_status: v.callbackDone ? '연락완료' : '미연락', callback_completed_at: v.callbackDone ? v.callbackCompletedAt || null : null, next_booking_date: v.nextVisitDate || null, memo: v.memo || null, created_at: v.createdAt }));
  const notes = next.dailyNotes.map((n) => ({ id: n.id, user_id: uid, note_date: n.date, memo: n.memo, created_at: n.createdAt }));
  if (customers.length) { const { error } = await supabase.from('customers').upsert(customers, { onConflict: 'id' }); if (error) throw error; }
  if (visits.length) { const { error } = await supabase.from('visits').upsert(visits, { onConflict: 'id' }); if (error) throw error; }
  if (notes.length) { const { error } = await supabase.from('daily_notes').upsert(notes, { onConflict: 'id' }); if (error) throw error; }
  const [{ data: rv }, { data: rc }, { data: rn }] = await Promise.all([supabase.from('visits').select('id').eq('user_id', uid), supabase.from('customers').select('id').eq('user_id', uid), supabase.from('daily_notes').select('id').eq('user_id', uid)]);
  const vd = (rv ?? []).map((x) => x.id).filter((x) => !next.visits.some((v) => v.id === x));
  const cd = (rc ?? []).map((x) => x.id).filter((x) => !next.customers.some((c) => c.id === x));
  const nd = (rn ?? []).map((x) => x.id).filter((x) => !next.dailyNotes.some((n) => n.id === x));
  if (vd.length) { const { error } = await supabase.from('visits').delete().in('id', vd); if (error) throw error; }
  if (cd.length) { const { error } = await supabase.from('customers').delete().in('id', cd); if (error) throw error; }
  if (nd.length) { const { error } = await supabase.from('daily_notes').delete().in('id', nd); if (error) throw error; }
}

function AppButton({ label, onPress, secondary = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', multiline = false, secureTextEntry = false, autoCapitalize = 'sentences' }: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: 'default' | 'number-pad' | 'email-address'; multiline?: boolean; secureTextEntry?: boolean; autoCapitalize?: 'none' | 'sentences' }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#a4a7a3"
        keyboardType={keyboardType}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  );
}

function DateField({ label, value, onChange, optional = false }: { label: string; value: string; onChange: (value: string) => void; optional?: boolean }) {
  const [open, setOpen] = useState(false);
  return <View style={styles.fieldWrap}>
    <Text style={styles.label}>{label}</Text>
    <Pressable onPress={() => setOpen(true)} style={styles.dateField}>
      <Text style={[styles.dateFieldText, !value && styles.dateFieldPlaceholder]}>{value ? `${value.replaceAll('-', '. ')}.` : '날짜를 선택해주세요.'}</Text>
      <Text style={styles.dateFieldIcon}>▣</Text>
    </Pressable>
    <DatePickerSheet visible={open} value={value} optional={optional} onClose={() => setOpen(false)} onSelect={(next) => { onChange(next); setOpen(false); }} />
  </View>;
}

function DatePickerSheet({ visible, value, optional, onClose, onSelect }: { visible: boolean; value: string; optional: boolean; onClose: () => void; onSelect: (value: string) => void }) {
  const [visibleMonth, setVisibleMonth] = useState(monthKey(value || todayIso()));
  useEffect(() => { if (visible) setVisibleMonth(monthKey(value || todayIso())); }, [visible, value]);
  const [year, month] = visibleMonth.split('-').map(Number);
  const first = new Date(year, month - 1, 1, 12);
  const gridStart = new Date(first); gridStart.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + index); return dateToIso(d); });
  const shift = (amount: number) => setVisibleMonth(dateToIso(new Date(year, month - 1 + amount, 1, 12)).slice(0, 7));
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Pressable style={styles.pickerBackdrop} onPress={onClose}>
      <Pressable style={styles.datePickerPanel} onPress={() => {}}>
        <View style={styles.datePickerTop}><Text style={styles.datePickerTitle}>날짜 선택</Text><Pressable onPress={onClose} hitSlop={12}><Text style={styles.datePickerClose}>×</Text></Pressable></View>
        <View style={styles.datePickerMonth}><Pressable onPress={() => shift(-1)} style={styles.monthArrow}><Text style={styles.monthArrowText}>‹</Text></Pressable><Text style={styles.monthPickerValue}>{year}년 {month}월</Text><Pressable onPress={() => shift(1)} style={styles.monthArrow}><Text style={styles.monthArrowText}>›</Text></Pressable></View>
        <View style={styles.weekRow}>{['일','월','화','수','목','금','토'].map((label, index) => <Text key={label} style={[styles.weekLabel, index === 0 && styles.sunday]}>{label}</Text>)}</View>
        <View style={styles.calendarGrid}>{days.map((day) => { const active = day === value; const inMonth = monthKey(day) === visibleMonth; return <Pressable key={day} onPress={() => onSelect(day)} style={[styles.datePickerDay, active && styles.dayCellActive]}><Text style={[styles.dayText, !inMonth && styles.dayMuted, active && styles.dayTextActive]}>{Number(day.slice(8))}</Text></Pressable>; })}</View>
        <View style={styles.datePickerActions}><AppButton label="오늘" secondary onPress={() => onSelect(todayIso())} />{optional && <AppButton label="날짜 지우기" secondary onPress={() => onSelect('')} />}</View>
      </Pressable>
    </Pressable>
  </Modal>;
}

function Header({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {action}
    </View>
  );
}

function Empty({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyMark}>＋</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{description}</Text>
      {actionLabel && onAction ? <AppButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<AppData>({ customers: [], visits: [], dailyNotes: [] });
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showVisit, setShowVisit] = useState(false);
  const [editingVisit, setEditingVisit] = useState<Visit | null>(null);
  const [visitInitialDate, setVisitInitialDate] = useState(todayIso());
  const [faceIdEnabled, setFaceIdEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [updateHistoryOpen, setUpdateHistoryOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: auth }) => { setSession(auth.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => { setSession(next); setAuthReady(true); if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true); if (!next) { setData({ customers: [], visits: [], dailyNotes: [] }); setLoaded(false); } });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handleUrl = async (url: string) => {
      const isPasswordReset = url.startsWith('myclientbook://reset-password');
      const params = new URLSearchParams(url.split('#')[1] ?? url.split('?')[1] ?? '');
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (!error) {
          setPasswordRecovery(isPasswordReset);
          if (!isPasswordReset) Alert.alert('이메일 인증 완료', '이제 앱을 바로 사용할 수 있어요.');
        }
      }
    };
    void Linking.getInitialURL().then((url) => { if (url) void handleUrl(url); });
    const listener = Linking.addEventListener('url', ({ url }) => void handleUrl(url));
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    (async () => {
      setLoaded(false);
      try {
        const [cached, pending, legacy, settings] = await Promise.all([AsyncStorage.getItem(cacheKey(session.user.id)), AsyncStorage.getItem(pendingKey(session.user.id)), AsyncStorage.getItem(LEGACY_KEY), AsyncStorage.getItem(SETTINGS_KEY)]);
        if (settings) {
          const parsed = JSON.parse(settings);
          setFaceIdEnabled(Boolean(parsed.faceIdEnabled));
          setLocked(Boolean(parsed.faceIdEnabled));
        }
        if (pending) {
          const local = normalizeData(JSON.parse(pending));
          if (active) setData(local);
          await writeCloud(local, session.user.id);
          await AsyncStorage.removeItem(pendingKey(session.user.id));
        } else {
          const cloud = await readCloud(session.user.id);
          const initial = cloud.customers.length || cloud.visits.length || cloud.dailyNotes.length ? cloud : cached ? normalizeData(JSON.parse(cached)) : legacy ? migrateLegacy(legacy) : { customers: [], visits: [], dailyNotes: [] };
          if (active) setData(initial);
          if (!cloud.customers.length && !cloud.visits.length && !cloud.dailyNotes.length && (cached || legacy)) {
            await writeCloud(initial, session.user.id);
            await AsyncStorage.setItem(cacheKey(session.user.id), JSON.stringify(initial));
            if (legacy) await AsyncStorage.removeItem(LEGACY_KEY);
          }
        }
        if (active) setSyncPending(false);
      } catch {
        const cached = await AsyncStorage.getItem(cacheKey(session.user.id));
        if (cached && active) setData(normalizeData(JSON.parse(cached)));
        if (active) setSyncPending(true);
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [session?.user.id]);

  const persist = async (next: AppData) => {
    if (!session) return;
    setData(next);
    await AsyncStorage.setItem(cacheKey(session.user.id), JSON.stringify(next));
    setSyncing(true);
    try { await writeCloud(next, session.user.id); await AsyncStorage.removeItem(pendingKey(session.user.id)); setSyncPending(false); }
    catch { await AsyncStorage.setItem(pendingKey(session.user.id), JSON.stringify(next)); setSyncPending(true); }
    finally { setSyncing(false); }
  };

  const refresh = async () => {
    if (!session) return;
    setSyncing(true);
    try { const cloud = await readCloud(session.user.id); setData(cloud); await AsyncStorage.setItem(cacheKey(session.user.id), JSON.stringify(cloud)); setSyncPending(false); }
    catch { Alert.alert('동기화할 수 없어요', '인터넷 연결을 확인해주세요. 기기에 저장된 기록은 유지됩니다.'); }
    finally { setSyncing(false); }
  };

  const unlock = async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'MY CLIENT BOOK 잠금 해제', cancelLabel: '취소' });
    if (result.success) setLocked(false);
  };

  if (!authReady) return <SafeAreaView style={styles.center}><Text style={styles.subtitle}>앱을 준비하고 있어요.</Text></SafeAreaView>;
  if (!session) return <AuthScreen />;
  if (passwordRecovery) return <ResetPasswordScreen onDone={() => setPasswordRecovery(false)} />;
  if (!loaded) return <SafeAreaView style={styles.center}><Text style={styles.subtitle}>고객 장부를 동기화하고 있어요.</Text></SafeAreaView>;
  if (locked) return (
    <SafeAreaView style={styles.lockScreen}>
      <StatusBar style="dark" />
      <Text style={styles.lockLogo}>MY{`\n`}CLIENT{`\n`}BOOK</Text>
      <Text style={styles.lockText}>고객 정보가 잠겨 있어요.</Text>
      <View style={{ width: 210 }}><AppButton label="Face ID로 열기" onPress={unlock} /></View>
    </SafeAreaView>
  );

  const selected = data.customers.find((c) => c.id === selectedId) ?? null;
  const saveCustomer = (customer: Customer) => {
    void persist({ ...data, customers: [...data.customers.filter((c) => c.id !== customer.id), customer] });
    setSelectedId(customer.id);
    setShowCustomer(false);
  };
  const saveVisit = (visit: Visit) => {
    void persist({ ...data, visits: [...data.visits.filter((v) => v.id !== visit.id), visit] });
    setShowVisit(false);
    setEditingVisit(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.app}>
        {selected ? (
          <CustomerDetail
            customer={selected}
            visits={data.visits.filter((v) => v.customerId === selected.id).sort((a, b) => b.date.localeCompare(a.date))}
            onBack={() => setSelectedId(null)}
            onEdit={() => setShowCustomer(true)}
            onVisit={() => { setEditingVisit(null); setVisitInitialDate(todayIso()); setShowVisit(true); }}
            onEditVisit={(visit) => { setEditingVisit(visit); setVisitInitialDate(visit.date); setShowVisit(true); }}
            onDeleteVisit={(visitId) => Alert.alert('방문 기록을 삭제할까요?', '이 방문 기록만 삭제되며 복구할 수 없어요.', [
              { text: '취소', style: 'cancel' },
              { text: '삭제', style: 'destructive', onPress: () => void persist({ ...data, visits: data.visits.filter((v) => v.id !== visitId) }) },
            ])}
            onDelete={() => Alert.alert('고객을 삭제할까요?', '방문 기록도 함께 삭제되며 복구할 수 없어요.', [
              { text: '취소', style: 'cancel' },
              { text: '삭제', style: 'destructive', onPress: () => { void persist({ ...data, customers: data.customers.filter((c) => c.id !== selected.id), visits: data.visits.filter((v) => v.customerId !== selected.id) }); setSelectedId(null); } },
            ])}
          />
        ) : (
          <>
            <TopBar onHome={() => setTab('home')} onMenu={() => setMenuOpen(true)} />
            <View style={styles.content}>
              {tab === 'home' && <Home data={data} onOpenCustomer={setSelectedId} onAdd={() => setShowCustomer(true)} />}
              {tab === 'customers' && <Customers customers={data.customers} visits={data.visits} onOpen={setSelectedId} onAdd={() => setShowCustomer(true)} />}
              {tab === 'calendar' && <CalendarScreen data={data} onOpen={setSelectedId} onAddVisit={(customerId, date) => { setSelectedId(customerId); setEditingVisit(null); setVisitInitialDate(date); setShowVisit(true); }} onSaveNote={(note) => void persist({ ...data, dailyNotes: [...data.dailyNotes.filter((n) => n.id !== note.id), note] })} onDeleteNote={(noteId) => void persist({ ...data, dailyNotes: data.dailyNotes.filter((n) => n.id !== noteId) })} />}
              {tab === 'callbacks' && <Callbacks data={data} onOpen={setSelectedId} onToggle={(visitId, done) => void persist({ ...data, visits: data.visits.map((v) => v.id === visitId ? { ...v, callbackDone: done, callbackCompletedAt: done ? new Date().toISOString() : undefined } : v) })} />}
              {tab === 'stats' && <Stats data={data} />}
              {tab === 'settings' && <Settings data={data} onChange={persist} faceIdEnabled={faceIdEnabled} setFaceIdEnabled={setFaceIdEnabled} email={session.user.email ?? ''} syncing={syncing} syncPending={syncPending} onRefresh={refresh} onShowUpdates={() => setUpdateHistoryOpen(true)} />}
            </View>
            <MenuSheet visible={menuOpen} current={tab} onClose={() => setMenuOpen(false)} onSelect={(next) => { setTab(next); setMenuOpen(false); }} />
          </>
        )}
      </View>
      <UpdateNotices historyOpen={updateHistoryOpen} onCloseHistory={() => setUpdateHistoryOpen(false)} available={!showCustomer && !showVisit && !menuOpen} />
      <CustomerEditor visible={showCustomer} initial={selected} onClose={() => setShowCustomer(false)} onSave={saveCustomer} />
      {selected && <VisitEditor visible={showVisit} customer={selected} initialDate={visitInitialDate} initial={editingVisit} onClose={() => { setShowVisit(false); setEditingVisit(null); }} onSave={saveVisit} />}
    </SafeAreaView>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [signup, setSignup] = useState(false); const [busy, setBusy] = useState(false); const [verificationSent, setVerificationSent] = useState(false);
  const submit = async () => {
    if (!email.trim() || password.length < 6) return Alert.alert('확인해주세요', '이메일과 6자리 이상의 비밀번호를 입력해주세요.');
    setBusy(true);
    const result = signup
      ? await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: 'myclientbook://verified' } })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (result.error) return Alert.alert(signup ? '회원가입할 수 없어요' : '로그인할 수 없어요', signup ? '이미 가입한 이메일일 수 있어요. 로그인하거나 비밀번호를 재설정해주세요.' : '이메일 또는 비밀번호를 확인해주세요.');
    if (signup && result.data.user?.identities?.length === 0) return Alert.alert('이미 가입한 이메일일 수 있어요', '로그인하거나 비밀번호 재설정을 이용해주세요.');
    if (signup && !result.data.session) { setVerificationSent(true); Alert.alert('인증 메일을 보냈어요', '스팸함도 확인해주세요. 인증을 완료한 뒤 로그인할 수 있어요.'); }
  };
  const resetPassword = async () => {
    if (!email.trim()) return Alert.alert('이메일을 입력해주세요.');
    setBusy(true); const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: 'myclientbook://reset-password' }); setBusy(false);
    Alert.alert(error ? '메일을 보낼 수 없어요' : '비밀번호 재설정 메일을 보냈어요', error ? '잠시 후 다시 시도해주세요.' : '메일의 링크를 누르면 앱에서 새 비밀번호를 설정할 수 있어요.');
  };
  const resend = async () => {
    if (!email.trim()) return Alert.alert('이메일을 입력해주세요.');
    setBusy(true); const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: 'myclientbook://verified' } }); setBusy(false);
    Alert.alert(error ? '인증 메일을 다시 보낼 수 없어요' : '인증 메일을 다시 보냈어요', error ? '잠시 후 다시 시도해주세요.' : '스팸함도 함께 확인해주세요.');
  };
  return <SafeAreaView style={styles.authSafe}><StatusBar style="dark" /><KeyboardAvoidingView style={styles.authWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Text style={styles.lockLogo}>MY{`\n`}CLIENT{`\n`}BOOK</Text><Text style={styles.authTitle}>{signup ? '새 계정 만들기' : '내 장부 열기'}</Text><Text style={styles.authSub}>같은 계정으로 로그인하면 새 휴대폰에서도 고객 기록을 그대로 불러옵니다.</Text><Field label="이메일" value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" /><Field label="비밀번호" value={password} onChangeText={setPassword} placeholder="6자리 이상" secureTextEntry autoCapitalize="none" /><AppButton label={busy ? '처리 중...' : signup ? '회원가입' : '로그인'} onPress={submit} disabled={busy} />{!signup && <Pressable onPress={resetPassword}><Text style={styles.authLink}>비밀번호를 잊으셨나요?</Text></Pressable>}{signup && verificationSent && <Pressable onPress={resend}><Text style={styles.authLink}>인증 메일 다시 보내기</Text></Pressable>}<Pressable onPress={() => setSignup((v) => !v)}><Text style={styles.authSwitch}>{signup ? '이미 계정이 있어요 · 로그인' : '처음 사용해요 · 회원가입'}</Text></Pressable></KeyboardAvoidingView></SafeAreaView>;
}

function ResetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => { if (password.length < 6 || password !== confirm) return Alert.alert('확인해주세요', '6자리 이상의 같은 비밀번호를 두 번 입력해주세요.'); setBusy(true); const { error } = await supabase.auth.updateUser({ password }); setBusy(false); if (error) return Alert.alert('변경할 수 없어요', '잠시 후 다시 시도해주세요.'); Alert.alert('변경 완료', '새 비밀번호로 로그인할 수 있어요.'); onDone(); };
  return <SafeAreaView style={styles.authSafe}><KeyboardAvoidingView style={styles.authWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Text style={styles.lockLogo}>MY{`\n`}CLIENT{`\n`}BOOK</Text><Text style={styles.authTitle}>새 비밀번호 설정</Text><Field label="새 비밀번호" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="6자리 이상" /><Field label="비밀번호 확인" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" placeholder="한 번 더 입력" /><AppButton label={busy ? '변경 중...' : '비밀번호 변경'} onPress={submit} disabled={busy} /></KeyboardAvoidingView></SafeAreaView>;
}

function Home({ data, onOpenCustomer, onAdd }: { data: AppData; onOpenCustomer: (id: string) => void; onAdd: () => void }) {
  const currentMonth = monthKey();
  const monthVisits = data.visits.filter((v) => monthKey(v.date) === currentMonth);
  const revenue = monthVisits.reduce((sum, v) => sum + v.price + v.productSales, 0);
  const due = getCallbacks(data).filter((x) => !x.visit.callbackDone);
  const recent = [...data.visits].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Header title="오늘의 장부" subtitle={`${new Date().getMonth() + 1}월 고객 흐름을 한눈에 확인하세요.`} action={<Pressable onPress={onAdd} style={styles.circleButton}><Text style={styles.circleButtonText}>＋</Text></Pressable>} />
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>이번 달 예상 매출</Text>
        <Text style={styles.heroValue}>{money(revenue)}</Text>
        <View style={styles.heroRow}>
          <View><Text style={styles.heroMiniValue}>{monthVisits.length}</Text><Text style={styles.heroMiniLabel}>방문</Text></View>
          <View><Text style={styles.heroMiniValue}>{due.length}</Text><Text style={styles.heroMiniLabel}>콜백 필요</Text></View>
          <View><Text style={styles.heroMiniValue}>{data.customers.length}</Text><Text style={styles.heroMiniLabel}>전체 고객</Text></View>
        </View>
      </View>
      <SectionTitle title="콜백 예정" count={due.length} />
      {due.length === 0 ? <View style={styles.slimEmpty}><Text style={styles.slimEmptyText}>오늘 챙길 콜백이 없어요.</Text></View> : due.slice(0, 3).map(({ customer, dueDate }) => (
        <Pressable key={customer.id} onPress={() => onOpenCustomer(customer.id)} style={styles.rowCard}>
          <Avatar name={customer.name} />
          <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{customer.name}</Text><Text style={styles.rowSub}>{customer.preferredStyle || '선호 스타일 미입력'}</Text></View>
          <Text style={styles.dueText}>{dueDate.slice(5).replace('-', '.')}</Text>
        </Pressable>
      ))}
      <SectionTitle title="최근 방문" count={recent.length} />
      {recent.length === 0 ? <Empty title="첫 고객을 등록해보세요" description="고객 정보와 방문 기록을 한곳에 차곡차곡 모을 수 있어요." actionLabel="고객 등록" onAction={onAdd} /> : recent.map((visit) => {
        const customer = data.customers.find((c) => c.id === visit.customerId);
        if (!customer) return null;
        return <Pressable key={visit.id} onPress={() => onOpenCustomer(customer.id)} style={styles.rowCard}><Avatar name={customer.name} /><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{customer.name}</Text><Text style={styles.rowSub}>{visit.service} · {visit.date}</Text></View><Text style={styles.rowPrice}>{money(visit.price + visit.productSales)}</Text></Pressable>;
      })}
    </ScrollView>
  );
}

function customerMemoPreview(notes: string, normalizedQuery: string): string {
  const lines = notes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!normalizedQuery) return lines[0] ?? '';
  const normalize = (value: string) => value.replace(/[^0-9a-zA-Z가-힣]/g, '').toLowerCase();
  const matchedLine = lines.find((line) => normalize(line).includes(normalizedQuery));
  const line = matchedLine ?? notes.replace(/\s+/g, ' ').trim();
  const matchIndex = normalize(line).indexOf(normalizedQuery);
  if (matchIndex < 0) return lines[0] ?? '';
  const positions: number[] = [];
  for (let i = 0; i < line.length; i += 1) {
    if (/[0-9a-zA-Z가-힣]/.test(line[i])) positions.push(i);
  }
  const start = Math.max(0, positions[matchIndex] - 8);
  return `${start > 0 ? '…' : ''}${line.slice(start)}`;
}

function Customers({ customers, visits, onOpen, onAdd }: { customers: Customer[]; visits: Visit[]; onOpen: (id: string) => void; onAdd: () => void }) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.replace(/[^0-9a-zA-Z가-힣]/g, '').toLowerCase();
  const matchesQuery = (value: string) => value.replace(/[^0-9a-zA-Z가-힣]/g, '').toLowerCase().includes(normalizedQuery);
  const visitCounts = new Map<string, number>();
  const matchedVisits = new Map<string, Visit>();
  for (const visit of visits) {
    visitCounts.set(visit.customerId, (visitCounts.get(visit.customerId) ?? 0) + 1);
    if (!normalizedQuery || !matchesQuery(visit.memo ?? '')) continue;
    const previous = matchedVisits.get(visit.customerId);
    if (!previous || visit.date > previous.date || (visit.date === previous.date && visit.createdAt > previous.createdAt)) {
      matchedVisits.set(visit.customerId, visit);
    }
  }
  const filtered = customers
    .filter((c) => [c.name, phoneDigits(c.phone), c.preferredStyle, c.notes]
      .some((value) => matchesQuery(value ?? '')) || matchedVisits.has(c.id))
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.id.localeCompare(b.id));
  return (
    <View style={styles.screen}>
      <Header title="고객" subtitle={`${customers.length}명의 고객이 기록되어 있어요.`} action={<Pressable onPress={onAdd} style={styles.circleButton}><Text style={styles.circleButtonText}>＋</Text></Pressable>} />
      <TextInput value={query} onChangeText={setQuery} placeholder="이름, 전화번호, 스타일, 메모 검색" placeholderTextColor="#969a96" style={styles.search} />
      {filtered.length === 0 ? <Empty title={query ? '검색 결과가 없어요' : '등록된 고객이 없어요'} description={query ? '이름, 전화번호, 스타일, 고객 메모 또는 방문 메모를 검색해보세요.' : '고객을 등록하면 방문 이력을 바로 연결할 수 있어요.'} actionLabel={query ? undefined : '고객 등록'} onAction={query ? undefined : onAdd} /> : (
        <FlatList data={filtered} keyExtractor={(c) => c.id} contentContainerStyle={{ paddingBottom: 30 }} renderItem={({ item }) => {
          const count = visitCounts.get(item.id) ?? 0;
          const matchedVisit = matchedVisits.get(item.id);
          const showVisitMemo = normalizedQuery && !matchesQuery(item.notes ?? '') && matchedVisit;
          const memoPreview = showVisitMemo
            ? `방문 메모 · ${customerMemoPreview(showVisitMemo.memo, normalizedQuery)}`
            : customerMemoPreview(item.notes ?? '', normalizedQuery);
          return (
            <Pressable onPress={() => onOpen(item.id)} style={styles.customerCard}>
              <Avatar name={item.name} large />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.customerName}>{item.name}</Text>
                <Text style={styles.rowSub}>{displayPhone(item.phone, true)}{item.preferredStyle ? ` · ${item.preferredStyle}` : ''}</Text>
                {memoPreview ? <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.rowSub, { marginTop: 5 }]}>{memoPreview}</Text> : null}
              </View>
              <View style={styles.countBadge}><Text style={styles.countText}>{count}회</Text></View>
            </Pressable>
          );
        }} />
      )}
    </View>
  );
}

function CalendarScreen({ data, onOpen, onAddVisit, onSaveNote, onDeleteNote }: { data: AppData; onOpen: (id: string) => void; onAddVisit: (id: string, date: string) => void; onSaveNote: (note: DailyNote) => void; onDeleteNote: (id: string) => void }) {
  const [selectedMonth, setSelectedMonth] = useState(monthKey());
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [editingNote, setEditingNote] = useState<DailyNote | null>(null);
  const [year, month] = selectedMonth.split('-').map(Number);
  const first = new Date(year, month - 1, 1, 12);
  const gridStart = new Date(first); gridStart.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + index); return dateToIso(d); });
  const shift = (amount: number) => { const next = dateToIso(new Date(year, month - 1 + amount, 1, 12)).slice(0, 7); setSelectedMonth(next); setSelectedDate(`${next}-01`); };
  const monthVisits = data.visits.filter((v) => monthKey(v.date) === selectedMonth);
  const selectedVisits = data.visits.filter((v) => v.date === selectedDate).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selectedNotes = data.dailyNotes.filter((n) => n.date === selectedDate).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const openNote = (note?: DailyNote) => { setEditingNote(note ?? null); setNoteText(note?.memo ?? ''); setNoteOpen(true); };
  const saveNote = () => { if (!noteText.trim()) return Alert.alert('메모 내용을 입력해주세요.'); onSaveNote({ id: editingNote?.id ?? uuid(), date: selectedDate, memo: noteText.trim(), createdAt: editingNote?.createdAt ?? new Date().toISOString() }); setNoteOpen(false); };
  const serviceSales = monthVisits.reduce((sum, v) => sum + v.price, 0); const productSales = monthVisits.reduce((sum, v) => sum + v.productSales, 0);
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Header title="캘린더" subtitle="날짜별 방문과 매출을 한눈에 확인하세요." />
    <View style={styles.monthPicker}><Pressable onPress={() => shift(-1)} style={styles.monthArrow}><Text style={styles.monthArrowText}>‹</Text></Pressable><Text style={styles.monthPickerValue}>{year}년 {month}월</Text><Pressable onPress={() => shift(1)} style={styles.monthArrow}><Text style={styles.monthArrowText}>›</Text></Pressable></View>
    <View style={styles.calendarCard}><View style={styles.weekRow}>{['일','월','화','수','목','금','토'].map((label, index) => <Text key={label} style={[styles.weekLabel, index === 0 && styles.sunday]}>{label}</Text>)}</View><View style={styles.calendarGrid}>{days.map((day) => { const count = data.visits.filter((v) => v.date === day).length; const hasNote = data.dailyNotes.some((n) => n.date === day); const inMonth = monthKey(day) === selectedMonth; const active = day === selectedDate; const today = day === todayIso(); return <Pressable key={day} onPress={() => setSelectedDate(day)} style={[styles.dayCell, active && styles.dayCellActive]}><View style={styles.dayNumberWrap}><Text style={[styles.dayText, !inMonth && styles.dayMuted, today && styles.dayToday, active && styles.dayTextActive]}>{Number(day.slice(8))}</Text>{today && <View style={[styles.todayIndicator, active && styles.todayIndicatorActive]} />}</View><View style={styles.dayMarkers}>{count > 0 && <View style={[styles.dayBadge, active && styles.dayBadgeActive]}><Text style={[styles.dayBadgeText, active && styles.dayBadgeTextActive]}>{count}</Text></View>}{hasNote && <View style={[styles.noteDot, active && styles.noteDotActive]} />}</View></Pressable>; })}</View></View>
    <View style={styles.calendarSummary}><View><Text style={styles.calendarSummaryLabel}>시술 매출</Text><Text style={styles.calendarSummaryValue}>{money(serviceSales)}</Text></View><View><Text style={styles.calendarSummaryLabel}>제품 매출</Text><Text style={styles.calendarSummaryValue}>{money(productSales)}</Text></View><View><Text style={styles.calendarSummaryLabel}>총매출</Text><Text style={styles.calendarSummaryValue}>{money(serviceSales + productSales)}</Text></View></View>
    <View style={styles.daySectionTop}><SectionTitle title={`${selectedDate.slice(5).replace('-', '월 ')}일 방문`} count={selectedVisits.length} /><Pressable onPress={() => data.customers.length ? setPickerOpen(true) : Alert.alert('먼저 고객을 등록해주세요.')} style={styles.smallAdd}><Text style={styles.smallAddText}>＋ 기록 추가</Text></Pressable></View>
    {selectedVisits.length === 0 ? <View style={styles.slimEmpty}><Text style={styles.slimEmptyText}>이 날짜에는 방문 기록이 없어요.</Text></View> : selectedVisits.map((visit) => { const customer = data.customers.find((c) => c.id === visit.customerId); return <Pressable key={visit.id} onPress={() => customer && onOpen(customer.id)} style={styles.rowCard}><Avatar name={customer?.name ?? '?'} /><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{customer?.name ?? '삭제된 고객'}</Text><Text style={styles.rowSub}>{visit.service} · {visit.visitType}</Text></View><Text style={styles.rowPrice}>{money(visit.price + visit.productSales)}</Text></Pressable>; })}
    <View style={styles.daySectionTop}><SectionTitle title="날짜 메모" count={selectedNotes.length} /><Pressable onPress={() => openNote()} style={styles.smallAdd}><Text style={styles.smallAddText}>＋ 메모 추가</Text></Pressable></View>
    {selectedNotes.length === 0 ? <View style={styles.slimEmpty}><Text style={styles.slimEmptyText}>이 날짜에 작성한 메모가 없어요.</Text></View> : selectedNotes.map((note) => <View key={note.id} style={styles.noteCard}><Text style={styles.noteText}>{note.memo}</Text><View style={styles.noteActions}><Pressable onPress={() => openNote(note)}><Text style={styles.noteEdit}>수정</Text></Pressable><Pressable onPress={() => Alert.alert('메모를 삭제할까요?', undefined, [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => onDeleteNote(note.id) }])}><Text style={styles.noteDelete}>삭제</Text></Pressable></View></View>)}
    <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}><Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}><Pressable style={styles.customerPicker} onPress={() => {}}><Text style={styles.customerPickerTitle}>고객 선택</Text><Text style={styles.customerPickerSub}>{selectedDate} 방문 기록을 추가합니다.</Text><ScrollView>{[...data.customers].sort((a,b) => a.name.localeCompare(b.name,'ko')).map((customer) => <Pressable key={customer.id} onPress={() => { setPickerOpen(false); onAddVisit(customer.id, selectedDate); }} style={styles.pickerCustomer}><Avatar name={customer.name} /><View><Text style={styles.rowTitle}>{customer.name}</Text><Text style={styles.rowSub}>{displayPhone(customer.phone, true)}</Text></View></Pressable>)}</ScrollView></Pressable></Pressable></Modal>
    <EditorShell visible={noteOpen} title={`${selectedDate.slice(5).replace('-', '월 ')}일 메모`} onClose={() => setNoteOpen(false)}><Field label="메모" value={noteText} onChangeText={setNoteText} placeholder="예약, 휴무, 할 일 등을 기록하세요." multiline /><AppButton label={editingNote ? '메모 수정' : '메모 저장'} onPress={saveNote} /></EditorShell>
  </ScrollView>;
}

function getCallbacks(data: AppData) {
  return data.customers.map((customer) => {
    const visit = data.visits.filter((v) => v.customerId === customer.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
    if (!visit?.nextVisitDate) return null;
    return { customer, visit, dueDate: visit.nextVisitDate };
  }).filter((x): x is NonNullable<typeof x> => Boolean(x)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function Callbacks({ data, onOpen, onToggle }: { data: AppData; onOpen: (id: string) => void; onToggle: (visitId: string, done: boolean) => void }) {
  const items = getCallbacks(data);
  const pending = items.filter((x) => !x.visit.callbackDone);
  const completed = items.filter((x) => x.visit.callbackDone).sort((a, b) => (b.visit.callbackCompletedAt ?? '').localeCompare(a.visit.callbackCompletedAt ?? '') || b.dueDate.localeCompare(a.dueDate));
  const renderCard = ({ customer, visit, dueDate }: (typeof items)[number], done: boolean) => (
    <View key={visit.id} style={[styles.callbackCard, done && styles.callbackCompleted]}>
      <Pressable onPress={() => onOpen(customer.id)} style={styles.callbackMain}><Avatar name={customer.name} large /><View style={{ flex: 1 }}><Text style={styles.customerName}>{customer.name}</Text><Text style={styles.rowSub}>최근 {visit.service} · {visit.date}</Text><Text style={[styles.callbackDue, dueDate > todayIso() && styles.callbackUpcoming]}>{done ? '연락 완료' : dueDate < todayIso() ? `${dueDate}부터 연락 필요` : dueDate === todayIso() ? '오늘 연락 예정' : `${dueDate} 방문 예정`}</Text></View></Pressable>
      <AppButton label={done ? '미연락으로 변경' : '연락 완료'} onPress={() => onToggle(visit.id, !done)} secondary />
    </View>
  );
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Header title="콜백" subtitle="예정된 다음 방문일을 빠짐없이 확인하세요." />
      {items.length === 0 ? <Empty title="예정된 콜백이 없어요" description="방문 기록에 다음 방문 예정일을 입력하면 이곳에 표시돼요." /> : <>
        <SectionTitle title="미연락" count={pending.length} />
        {pending.length ? pending.map((item) => renderCard(item, false)) : <View style={styles.slimEmpty}><Text style={styles.slimEmptyText}>미연락 콜백이 없어요.</Text></View>}
        <SectionTitle title="연락 완료" count={completed.length} />
        {completed.length ? completed.map((item) => renderCard(item, true)) : <View style={styles.slimEmpty}><Text style={styles.slimEmptyText}>완료한 콜백이 없어요.</Text></View>}
      </>}
    </ScrollView>
  );
}

function Stats({ data }: { data: AppData }) {
  const [selectedMonth, setSelectedMonth] = useState(monthKey());
  const shift = (amount: number) => { const [year, month] = selectedMonth.split('-').map(Number); const d = new Date(year, month - 1 + amount, 1, 12); setSelectedMonth(d.toISOString().slice(0, 7)); };
  const visits = data.visits.filter((v) => monthKey(v.date) === selectedMonth);
  const unique = new Set(visits.map((v) => v.customerId)).size;
  const newCustomers = new Set(visits.filter((v) => v.visitType === '신규').map((v) => v.customerId)).size;
  const returningCustomers = new Set(visits.filter((v) => v.visitType === '재방문').map((v) => v.customerId)).size;
  const revisitRate = unique ? Math.round((returningCustomers / unique) * 100) : 0;
  const serviceSales = visits.reduce((sum, v) => sum + v.price, 0);
  const productSales = visits.reduce((sum, v) => sum + v.productSales, 0);
  const totalSales = serviceSales + productSales;
  const months = Array.from({ length: 6 }, (_, i) => { const [year, month] = selectedMonth.split('-').map(Number); const d = new Date(year, month - 1 - (5 - i), 1, 12); return d.toISOString().slice(0, 7); });
  const rows = months.map((month) => { const values = data.visits.filter((v) => monthKey(v.date) === month); return { month, revenue: values.reduce((sum, v) => sum + v.price + v.productSales, 0) }; });
  const max = Math.max(...rows.map((r) => r.revenue), 1);
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Header title="통계" subtitle="감이 아니라 기록으로 고객 흐름을 확인하세요." />
      <View style={styles.monthPicker}><Pressable onPress={() => shift(-1)} style={styles.monthArrow}><Text style={styles.monthArrowText}>‹</Text></Pressable><View><Text style={styles.monthPickerLabel}>조회 월</Text><Text style={styles.monthPickerValue}>{selectedMonth.replace('-', '년 ')}월</Text></View><Pressable onPress={() => shift(1)} style={styles.monthArrow}><Text style={styles.monthArrowText}>›</Text></Pressable></View>
      <SectionTitle title="고객 통계" />
      <View style={styles.statGrid}>
        <StatCard label="전체 방문" value={`${visits.length}회`} />
        <StatCard label="방문 고객" value={`${unique}명`} />
        <StatCard label="신규 고객" value={`${newCustomers}명`} />
        <StatCard label="재방문 고객" value={`${returningCustomers}명`} />
        <StatCard label="재방문률" value={`${revisitRate}%`} />
        <StatCard label="평균 객단가" value={visits.length ? money(totalSales / visits.length) : '0원'} />
      </View>
      <SectionTitle title="매출 통계" />
      <View style={styles.salesCard}><View style={styles.salesRow}><Text style={styles.salesLabel}>시술 매출</Text><Text style={styles.salesValue}>{money(serviceSales)}</Text></View><View style={styles.salesRow}><Text style={styles.salesLabel}>제품 판매 매출</Text><Text style={styles.salesValue}>{money(productSales)}</Text></View><View style={[styles.salesRow, styles.salesTotal]}><Text style={styles.salesTotalLabel}>총매출</Text><Text style={styles.salesTotalValue}>{money(totalSales)}</Text></View></View>
      <SectionTitle title="6개월 매출 흐름" />
      <View style={styles.chartCard}>{rows.map((row) => <View key={row.month} style={styles.chartRow}><Text style={styles.chartLabel}>{Number(row.month.slice(5))}월</Text><View style={styles.chartTrack}><View style={[styles.chartBar, { width: `${Math.max(3, (row.revenue / max) * 100)}%` }]} /></View><Text style={styles.chartValue}>{row.revenue ? `${Math.round(row.revenue / 10000)}만` : '0'}</Text></View>)}</View>
      <SectionTitle title="이번 달 방문 흐름" count={visits.length} />
      {[...visits].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map((visit) => { const customer = data.customers.find((c) => c.id === visit.customerId); return <View key={visit.id} style={styles.rowCard}><Avatar name={customer?.name ?? '?'} /><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{customer?.name ?? '삭제된 고객'}</Text><Text style={styles.rowSub}>{visit.date} · {visit.visitType} · {visit.service}</Text></View><Text style={styles.rowPrice}>{money(visit.price + visit.productSales)}</Text></View>; })}
    </ScrollView>
  );
}

function Settings({ data, onChange, faceIdEnabled, setFaceIdEnabled, email, syncing, syncPending, onRefresh, onShowUpdates }: { data: AppData; onChange: (data: AppData) => Promise<void>; faceIdEnabled: boolean; setFaceIdEnabled: (v: boolean) => void; email: string; syncing: boolean; syncPending: boolean; onRefresh: () => Promise<void>; onShowUpdates: () => void }) {
  const toggleFaceId = async (value: boolean) => {
    if (value) {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!compatible || !enrolled) return Alert.alert('Face ID를 사용할 수 없어요', '기기의 Face ID 설정을 먼저 확인해주세요.');
      const auth = await LocalAuthentication.authenticateAsync({ promptMessage: 'Face ID 잠금 설정' });
      if (!auth.success) return;
    }
    setFaceIdEnabled(value);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ faceIdEnabled: value }));
  };
  const backup = async () => {
    try {
      const path = `${FileSystem.cacheDirectory}my-client-book-${todayIso()}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), data }, null, 2));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'MY CLIENT BOOK 백업 저장' });
    } catch { Alert.alert('백업에 실패했어요', '잠시 후 다시 시도해주세요.'); }
  };
  const exportExcel = async () => {
    try {
      const customerRows = [...data.customers].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((customer) => {
        const visits = data.visits.filter((visit) => visit.customerId === customer.id);
        const latest = [...visits].sort((a, b) => b.date.localeCompare(a.date))[0];
        return [
          customer.name,
          displayPhone(customer.phone),
          customer.preferredStyle,
          customer.notes,
          visits.length,
          visits.reduce((sum, visit) => sum + visit.price + visit.productSales, 0),
          latest?.date ?? '',
        ];
      });
      const visitRows = [...data.visits].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map((visit) => {
        const customer = data.customers.find((item) => item.id === visit.customerId);
        return [
          visit.date,
          customer?.name ?? '삭제된 고객',
          customer ? displayPhone(customer.phone) : '',
          visit.visitType,
          visit.service,
          visit.price,
          visit.productSales,
          visit.price + visit.productSales,
          visit.nextVisitDate ?? '',
          visit.callbackDone ? '연락완료' : '미연락',
          visit.memo,
        ];
      });
      const customerSheet = XLSX.utils.aoa_to_sheet([
        ['고객명', '전화번호', '선호 스타일', '고객 메모', '방문수', '누적매출', '최근 방문일'],
        ...customerRows,
      ]);
      customerSheet['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 36 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
      const visitSheet = XLSX.utils.aoa_to_sheet([
        ['방문일', '고객명', '전화번호', '방문 구분', '시술명', '시술 금액', '제품 판매 금액', '총매출', '다음 방문 예정일', '콜백 상태', '시술 메모'],
        ...visitRows,
      ]);
      visitSheet['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 24 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 40 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, customerSheet, '고객목록');
      XLSX.utils.book_append_sheet(workbook, visitSheet, '방문기록');
      const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
      const path = `${FileSystem.cacheDirectory}MY_CLIENT_BOOK_${todayIso()}.xlsx`;
      await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', UTI: 'org.openxmlformats.spreadsheetml.sheet', dialogTitle: 'MY CLIENT BOOK Excel 내보내기' });
    } catch { Alert.alert('Excel 파일을 만들 수 없어요', '잠시 후 다시 시도해주세요.'); }
  };
  const reset = () => Alert.alert('모든 기록을 삭제할까요?', '계정은 유지되고 고객·방문 기록·캘린더 메모만 삭제됩니다.', [{ text: '취소', style: 'cancel' }, { text: '전체 삭제', style: 'destructive', onPress: () => void onChange({ customers: [], visits: [], dailyNotes: [] }) }]);
  const deleteAccount = () => Alert.alert('계정과 모든 데이터를 삭제할까요?', '서버와 이 기기의 기록이 모두 삭제되며 복구할 수 없어요.', [{ text: '취소', style: 'cancel' }, { text: '계정 삭제', style: 'destructive', onPress: async () => { const { error } = await supabase.functions.invoke('delete-account', { body: { confirm: true } }); if (error) return Alert.alert('계정을 삭제할 수 없어요', '잠시 후 다시 시도해주세요.'); await supabase.auth.signOut(); } }]);
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Header title="설정" subtitle="계정에 안전하게 동기화되어 새 휴대폰에서도 복원됩니다." />
      <View style={styles.privacyCard}><Text style={styles.privacyTitle}>{email}</Text><Text style={styles.privacyText}>{syncing ? '동기화 중...' : syncPending ? '오프라인 저장됨 · 연결되면 자동 동기화' : '모든 기록 동기화 완료'}</Text></View>
      <Pressable onPress={() => void onRefresh()} style={styles.settingCard}><View style={{ flex: 1 }}><Text style={styles.settingTitle}>지금 동기화</Text><Text style={styles.settingSub}>서버의 최신 기록을 다시 불러옵니다.</Text></View><Text style={styles.chevron}>›</Text></Pressable>
      <View style={styles.settingCard}><View style={{ flex: 1 }}><Text style={styles.settingTitle}>Face ID 잠금</Text><Text style={styles.settingSub}>앱을 열 때 고객 정보를 보호합니다.</Text></View><Switch value={faceIdEnabled} onValueChange={toggleFaceId} trackColor={{ true: ACCENT }} /></View>
      <Pressable onPress={backup} style={styles.settingCard}><View style={{ flex: 1 }}><Text style={styles.settingTitle}>데이터 백업</Text><Text style={styles.settingSub}>고객과 방문 기록을 파일로 안전하게 저장합니다.</Text></View><Text style={styles.chevron}>›</Text></Pressable>
      <Pressable onPress={exportExcel} style={styles.settingCard}><View style={{ flex: 1 }}><Text style={styles.settingTitle}>Excel로 내보내기</Text><Text style={styles.settingSub}>고객목록과 방문기록을 확인용 파일로 저장합니다.</Text></View><Text style={styles.chevron}>›</Text></Pressable>
      <View style={styles.privacyCard}><Text style={styles.privacyTitle}>계정 동기화</Text><Text style={styles.privacyText}>고객, 방문 기록과 캘린더 메모를 저장합니다. 사진, 관리자센터, 인증 코드, 체험판 기능은 사용하지 않습니다.</Text></View>
      <Pressable accessibilityRole="button" onPress={onShowUpdates} style={styles.settingCard}><View style={{ flex: 1 }}><Text style={styles.settingTitle}>업데이트 내역</Text><Text style={styles.settingSub}>버전별 새로운 기능과 개선사항을 확인합니다.</Text></View><Text style={styles.chevron}>›</Text></Pressable>
      <AppButton label="로그아웃" secondary onPress={() => void supabase.auth.signOut()} />
      <Pressable onPress={reset} style={styles.dangerButton}><Text style={styles.dangerText}>모든 데이터 삭제</Text></Pressable>
      <Pressable onPress={deleteAccount} style={styles.dangerButton}><Text style={styles.dangerText}>계정 삭제</Text></Pressable>
      <Text style={styles.version}>MY CLIENT BOOK {APP_VERSION} · HenryLAB</Text>
    </ScrollView>
  );
}

function CustomerDetail({ customer, visits, onBack, onEdit, onVisit, onEditVisit, onDeleteVisit, onDelete }: { customer: Customer; visits: Visit[]; onBack: () => void; onEdit: () => void; onVisit: () => void; onEditVisit: (visit: Visit) => void; onDeleteVisit: (visitId: string) => void; onDelete: () => void }) {
  const total = visits.reduce((sum, v) => sum + v.price + v.productSales, 0);
  return (
    <ScrollView contentContainerStyle={styles.detailScroll}>
      <View style={styles.detailTop}><Pressable onPress={onBack}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.detailTopTitle}>고객 상세</Text><Pressable onPress={onEdit}><Text style={styles.edit}>수정</Text></Pressable></View>
      <View style={styles.profile}><Avatar name={customer.name} xlarge /><Text style={styles.profileName}>{customer.name}</Text><Text style={styles.profileSub}>{displayPhone(customer.phone)}</Text></View>
      <View style={styles.summaryCard}><View><Text style={styles.summaryValue}>{visits.length}</Text><Text style={styles.summaryLabel}>방문</Text></View><View style={styles.divider} /><View><Text style={styles.summaryValue}>{money(total)}</Text><Text style={styles.summaryLabel}>누적 매출</Text></View><View style={styles.divider} /><View><Text style={styles.summaryValue}>{visits.filter((v) => v.visitType === '재방문').length}</Text><Text style={styles.summaryLabel}>재방문</Text></View></View>
      <View style={styles.infoCard}><Info label="선호 스타일" value={customer.preferredStyle || '미입력'} /><Info label="상담 메모" value={customer.notes || '미입력'} /></View>
      <AppButton label="새 방문 기록 추가" onPress={onVisit} />
      <SectionTitle title="방문 타임라인" count={visits.length} />
      {visits.length === 0 ? <Empty title="방문 기록이 없어요" description="첫 시술 기록을 남겨보세요." /> : visits.map((visit) => <View key={visit.id} style={styles.visitCard}><View style={{ flex: 1 }}><Text style={styles.visitDate}>{visit.date} · {visit.visitType}</Text><Text style={styles.visitService}>{visit.service}</Text>{!!visit.memo && <Text style={styles.visitMemo}>{visit.memo}</Text>}<Text style={styles.visitPrice}>시술 {money(visit.price)} · 제품 {money(visit.productSales)}</Text>{!!visit.nextVisitDate && <Text style={styles.nextVisit}>다음 방문 예정일 {visit.nextVisitDate}</Text>}<View style={styles.visitActions}><Pressable onPress={() => onEditVisit(visit)}><Text style={styles.visitEdit}>수정</Text></Pressable><Pressable onPress={() => onDeleteVisit(visit.id)}><Text style={styles.visitDelete}>삭제</Text></Pressable></View></View></View>)}
      <Pressable onPress={onDelete} style={styles.dangerButton}><Text style={styles.dangerText}>고객 삭제</Text></Pressable>
    </ScrollView>
  );
}

function CustomerEditor({ visible, initial, onClose, onSave }: { visible: boolean; initial: Customer | null; onClose: () => void; onSave: (c: Customer) => void }) {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [style, setStyle] = useState(''); const [notes, setNotes] = useState('');
  useEffect(() => { if (visible) { setName(initial?.name ?? ''); setPhone(initial?.phone ?? ''); setStyle(initial?.preferredStyle ?? ''); setNotes(initial?.notes ?? ''); } }, [visible, initial]);
  const submit = () => { const digits = phoneDigits(phone); if (!name.trim()) return Alert.alert('고객 이름을 입력해주세요.'); if (digits.length !== 0 && digits.length !== 4 && digits.length !== 10 && digits.length !== 11) return Alert.alert('전화번호를 확인해주세요', '전체 전화번호 또는 뒷자리 4자리만 입력할 수 있어요.'); onSave({ id: initial?.id ?? uuid(), name: name.trim(), phone: digits, preferredStyle: style.trim(), notes: notes.trim(), createdAt: initial?.createdAt ?? new Date().toISOString() }); };
  return <EditorShell visible={visible} title={initial ? '고객 정보 수정' : '새 고객 등록'} onClose={onClose}><Field label="고객 이름 *" value={name} onChangeText={setName} placeholder="이름 또는 활동명" /><Field label="전화번호" value={phone} onChangeText={(v) => setPhone(phoneDigits(v))} placeholder="전체 번호 또는 뒷자리 4자리" keyboardType="number-pad" /><Text style={styles.fieldHelp}>입력하지 않아도 되고, 01012345678 또는 5678처럼 입력해도 돼요.</Text><Field label="선호 스타일" value={style} onChangeText={setStyle} placeholder="예: 슬릭컷, 하이레이어드" /><Field label="상담 및 특이사항" value={notes} onChangeText={setNotes} placeholder="모질, 두피 상태, 선호도 등을 기록하세요." multiline /><AppButton label={initial ? '수정 완료' : '고객 등록'} onPress={submit} /></EditorShell>;
}

function VisitEditor({ visible, customer, initialDate, initial, onClose, onSave }: { visible: boolean; customer: Customer; initialDate: string; initial: Visit | null; onClose: () => void; onSave: (v: Visit) => void }) {
  const [date, setDate] = useState(todayIso()); const [service, setService] = useState(''); const [memo, setMemo] = useState(''); const [price, setPrice] = useState(''); const [product, setProduct] = useState(''); const [visitType, setVisitType] = useState<'신규' | '재방문'>('재방문'); const [nextDate, setNextDate] = useState('');
  useEffect(() => { if (visible) { setDate(initial?.date ?? initialDate); setService(initial?.service ?? ''); setMemo(initial?.memo ?? ''); setPrice(initial ? String(initial.price) : ''); setProduct(initial ? String(initial.productSales) : ''); setVisitType(initial?.visitType ?? '재방문'); setNextDate(initial?.nextVisitDate ?? ''); } }, [visible, initialDate, initial]);
  const submit = () => { if (!service.trim()) return Alert.alert('시술명을 입력해주세요.'); onSave({ id: initial?.id ?? uuid(), customerId: customer.id, date, service: service.trim(), memo: memo.trim(), price: parseMoney(price), productSales: parseMoney(product), visitType, nextVisitDate: nextDate || undefined, callbackDone: initial?.callbackDone ?? false, callbackCompletedAt: initial?.callbackCompletedAt, createdAt: initial?.createdAt ?? new Date().toISOString() }); };
  return <EditorShell visible={visible} title={initial ? `${customer.name} 방문 수정` : `${customer.name} 방문 기록`} onClose={onClose}><DateField label="방문일 *" value={date} onChange={setDate} /><Text style={styles.label}>방문 구분</Text><View style={styles.segment}><Pressable onPress={() => setVisitType('신규')} style={[styles.segmentButton, visitType === '신규' && styles.segmentActive]}><Text style={[styles.segmentText, visitType === '신규' && styles.segmentTextActive]}>신규</Text></Pressable><Pressable onPress={() => setVisitType('재방문')} style={[styles.segmentButton, visitType === '재방문' && styles.segmentActive]}><Text style={[styles.segmentText, visitType === '재방문' && styles.segmentTextActive]}>재방문</Text></Pressable></View><Field label="시술명 *" value={service} onChangeText={setService} placeholder="예: 디자인컷 + 다운펌" /><View style={styles.moneyRow}><View style={{ flex: 1 }}><Field label="시술 금액" value={price} onChangeText={setPrice} placeholder="0" keyboardType="number-pad" /></View><View style={{ flex: 1 }}><Field label="제품 판매 금액" value={product} onChangeText={setProduct} placeholder="0" keyboardType="number-pad" /></View></View><DateField label="다음 방문 예정일" value={nextDate} onChange={setNextDate} optional /><Field label="시술 메모" value={memo} onChangeText={setMemo} placeholder="약제, 배합, 디자인 포인트 등을 기록하세요." multiline /><AppButton label={initial ? '방문 기록 수정' : '방문 기록 저장'} onPress={submit} /></EditorShell>;
}

function EditorShell({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><SafeAreaView style={styles.modalSafe}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={styles.modalTop}><Pressable onPress={onClose}><Text style={styles.modalClose}>취소</Text></Pressable><Text style={styles.modalTitle}>{title}</Text><View style={{ width: 36 }} /></View><ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">{children}</ScrollView></KeyboardAvoidingView></SafeAreaView></Modal>;
}

const MENU_ITEMS: { key: Tab; icon: string; label: string }[] = [
  { key: 'home', icon: '⌂', label: '홈' }, { key: 'customers', icon: '○', label: '고객' }, { key: 'calendar', icon: '□', label: '캘린더' },
  { key: 'callbacks', icon: '◷', label: '콜백' }, { key: 'stats', icon: '▥', label: '통계' }, { key: 'settings', icon: '⋯', label: '설정' },
];

function TopBar({ onHome, onMenu }: { onHome: () => void; onMenu: () => void }) {
  return <View style={styles.topBar}><Pressable onPress={onHome} hitSlop={12}><Text style={styles.topLogo}>MY CLIENT BOOK</Text></Pressable><Pressable onPress={onMenu} style={styles.menuButton} accessibilityLabel="메뉴 열기"><View style={styles.menuLine} /><View style={styles.menuLine} /><View style={styles.menuLine} /></Pressable></View>;
}

function MenuSheet({ visible, current, onClose, onSelect }: { visible: boolean; current: Tab; onClose: () => void; onSelect: (tab: Tab) => void }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><Pressable style={styles.menuBackdrop} onPress={onClose}><Pressable style={styles.menuPanel} onPress={() => {}}><View style={styles.menuPanelTop}><Text style={styles.menuPanelTitle}>메뉴</Text><Pressable onPress={onClose} hitSlop={12}><Text style={styles.menuClose}>×</Text></Pressable></View>{MENU_ITEMS.map((item) => <Pressable key={item.key} onPress={() => onSelect(item.key)} style={[styles.menuItem, current === item.key && styles.menuItemActive]}><View style={styles.menuIconWrap}><Text style={[styles.menuItemIcon, current === item.key && styles.menuItemTextActive]}>{item.icon}</Text></View><Text style={[styles.menuItemText, current === item.key && styles.menuItemTextActive]}>{item.label}</Text></Pressable>)}</Pressable></Pressable></Modal>;
}

function Avatar({ name, large = false, xlarge = false }: { name: string; large?: boolean; xlarge?: boolean }) { return <View style={[styles.avatar, large && styles.avatarLarge, xlarge && styles.avatarXL]}><Text style={[styles.avatarText, (large || xlarge) && { fontSize: xlarge ? 30 : 20 }]}>{name.trim().slice(0, 1) || '?'}</Text></View>; }
function SectionTitle({ title, count }: { title: string; count?: number }) { return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text>{typeof count === 'number' && <Text style={styles.sectionCount}>{count}</Text>}</View>; }
function StatCard({ label, value }: { label: string; value: string }) { return <View style={styles.statCard}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>; }
function Info({ label, value }: { label: string; value: string }) { return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG }, app: { flex: 1 }, content: { flex: 1 }, screen: { flex: 1, paddingHorizontal: 20, paddingTop: 18 }, scroll: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 36 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  authSafe: { flex: 1, backgroundColor: BG }, authWrap: { flex: 1, justifyContent: 'center', padding: 30 }, authTitle: { fontSize: 27, fontWeight: '900', color: '#171a17', marginTop: 30, marginBottom: 7 }, authSub: { color: '#717772', lineHeight: 21, marginBottom: 28 }, authSwitch: { textAlign: 'center', color: ACCENT, fontWeight: '800', paddingVertical: 18 }, authLink: { textAlign: 'center', color: '#4f625c', fontWeight: '700', fontSize: 14, paddingTop: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 22 }, eyebrow: { color: ACCENT, fontSize: 12, fontWeight: '800', letterSpacing: 2.2, marginBottom: 6 }, title: { color: '#151815', fontSize: 31, fontWeight: '800', letterSpacing: -1 }, subtitle: { color: '#747a75', fontSize: 14, lineHeight: 21, marginTop: 7 },
  circleButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e0e3de' }, circleButtonText: { fontSize: 28, color: ACCENT, fontWeight: '300', marginTop: -2 },
  heroCard: { backgroundColor: '#173f36', borderRadius: 25, padding: 24, marginBottom: 26 }, heroLabel: { color: '#b9d1ca', fontSize: 13, fontWeight: '700' }, heroValue: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 8, letterSpacing: -1 }, heroRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#57766e' }, heroMiniValue: { color: '#fff', fontSize: 18, fontWeight: '800' }, heroMiniLabel: { color: '#a8c0ba', fontSize: 12, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 12 }, sectionTitle: { fontSize: 20, fontWeight: '800', color: '#181b18' }, sectionCount: { marginLeft: 8, color: ACCENT, fontWeight: '800' }, rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 18, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#e6e8e4' }, rowTitle: { color: '#1b1e1b', fontWeight: '800', fontSize: 16 }, rowSub: { color: '#7c817d', fontSize: 13, marginTop: 4 }, rowPrice: { color: '#333833', fontWeight: '700', fontSize: 13 }, dueText: { color: '#b15f3b', fontWeight: '800', fontSize: 13 },
  avatar: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#dcebe5', alignItems: 'center', justifyContent: 'center', marginRight: 12 }, avatarLarge: { width: 54, height: 54, borderRadius: 19 }, avatarXL: { width: 82, height: 82, borderRadius: 28, marginRight: 0 }, avatarText: { color: ACCENT, fontWeight: '900', fontSize: 17 },
  button: { minHeight: 54, borderRadius: 17, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginVertical: 5 }, buttonSecondary: { backgroundColor: '#edf3f0' }, buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' }, buttonTextSecondary: { color: ACCENT }, pressed: { opacity: 0.72 }, disabled: { opacity: 0.4 },
  empty: { backgroundColor: '#fff', padding: 28, borderRadius: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e4e7e2', marginTop: 8 }, emptyMark: { color: ACCENT, fontSize: 42, fontWeight: '200' }, emptyTitle: { fontSize: 19, fontWeight: '800', color: '#1b1e1b', marginTop: 8 }, emptyText: { color: '#7b807b', textAlign: 'center', lineHeight: 20, marginVertical: 10 }, slimEmpty: { padding: 18, borderRadius: 16, backgroundColor: '#e9eeea', marginBottom: 15 }, slimEmptyText: { color: '#737a74', textAlign: 'center' },
  search: { backgroundColor: '#fff', minHeight: 52, borderRadius: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: '#e0e3df', marginBottom: 14, fontSize: 15 }, customerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 11, borderWidth: 1, borderColor: '#e4e7e3' }, customerName: { fontSize: 17, fontWeight: '800', color: '#1b1e1b' }, countBadge: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#edf3f0', borderRadius: 10 }, countText: { color: ACCENT, fontSize: 12, fontWeight: '800' },
  callbackCard: { backgroundColor: '#fff', borderRadius: 22, padding: 17, marginBottom: 12, borderWidth: 1, borderColor: '#e3e6e2' }, callbackCompleted: { opacity: 0.72 }, callbackMain: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 }, callbackDue: { color: '#b15f3b', fontWeight: '700', fontSize: 12, marginTop: 7 }, callbackUpcoming: { color: ACCENT },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, statCard: { width: '48.5%', backgroundColor: '#fff', borderRadius: 20, padding: 18, marginBottom: 10, minHeight: 105, justifyContent: 'space-between', borderWidth: 1, borderColor: '#e3e6e2' }, statLabel: { color: '#777d78', fontSize: 13 }, statValue: { color: '#1b1e1b', fontSize: 19, fontWeight: '900', letterSpacing: -0.5 }, chartCard: { backgroundColor: '#fff', borderRadius: 22, padding: 18, borderWidth: 1, borderColor: '#e3e6e2' }, chartRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 9 }, chartLabel: { width: 32, color: '#727772', fontSize: 12 }, chartTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: '#e9ece8', overflow: 'hidden' }, chartBar: { height: 10, borderRadius: 5, backgroundColor: ACCENT }, chartValue: { width: 43, textAlign: 'right', color: '#555b56', fontSize: 11, fontWeight: '700' },
  monthPicker: { minHeight: 70, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5e1', paddingHorizontal: 12, marginBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, monthArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, monthArrowText: { fontSize: 34, color: ACCENT, fontWeight: '300' }, monthPickerLabel: { textAlign: 'center', color: '#888d88', fontSize: 11 }, monthPickerValue: { color: '#1c201c', fontSize: 18, fontWeight: '900', textAlign: 'center', marginTop: 3 },
  salesCard: { backgroundColor: '#173f36', borderRadius: 22, padding: 20, marginBottom: 18 }, salesRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9 }, salesLabel: { color: '#b2cac3', fontSize: 14 }, salesValue: { color: '#fff', fontSize: 15, fontWeight: '800' }, salesTotal: { marginTop: 7, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#6a8981' }, salesTotalLabel: { color: '#fff', fontSize: 16, fontWeight: '900' }, salesTotalValue: { color: '#fff', fontSize: 21, fontWeight: '900' },
  settingCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 19, padding: 18, marginBottom: 10, borderWidth: 1, borderColor: '#e4e7e2' }, settingTitle: { color: '#1c1f1c', fontSize: 16, fontWeight: '800' }, settingSub: { color: '#7d827e', fontSize: 13, marginTop: 5, lineHeight: 18 }, chevron: { color: '#8b908c', fontSize: 28 }, privacyCard: { backgroundColor: '#e5eee9', borderRadius: 20, padding: 19, marginVertical: 12 }, privacyTitle: { color: '#244a40', fontWeight: '900', fontSize: 16 }, privacyText: { color: '#587067', lineHeight: 20, fontSize: 13, marginTop: 8 }, dangerButton: { minHeight: 54, paddingVertical: 17, alignItems: 'center', justifyContent: 'center', marginTop: 10 }, dangerText: { color: '#bc554c', fontSize: 16, fontWeight: '800' }, version: { textAlign: 'center', color: '#a1a5a1', fontSize: 12, marginTop: 20 },
  topBar: { height: 62, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: BG, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d9dcd8' }, topLogo: { color: '#173f36', fontSize: 16, fontWeight: '900', letterSpacing: 1.5 }, menuButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dfe3de', alignItems: 'center', justifyContent: 'center', gap: 4 }, menuLine: { width: 20, height: 2, borderRadius: 1, backgroundColor: '#203f37' }, menuBackdrop: { flex: 1, backgroundColor: 'rgba(17,25,21,0.35)', alignItems: 'flex-end' }, menuPanel: { width: '78%', height: '100%', backgroundColor: BG, paddingTop: 58, paddingHorizontal: 20 }, menuPanelTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }, menuPanelTitle: { fontSize: 26, fontWeight: '900', color: '#171a17' }, menuClose: { fontSize: 36, color: '#343934', fontWeight: '300' }, menuItem: { minHeight: 62, borderRadius: 18, paddingHorizontal: 15, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }, menuItemActive: { backgroundColor: '#dfece7' }, menuIconWrap: { width: 40, alignItems: 'center' }, menuItemIcon: { color: '#747b76', fontSize: 23, fontWeight: '700' }, menuItemText: { color: '#343934', fontSize: 17, fontWeight: '800', marginLeft: 8 }, menuItemTextActive: { color: ACCENT },
  detailScroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }, detailTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 54 }, back: { fontSize: 40, color: '#242824', fontWeight: '300' }, detailTopTitle: { fontSize: 16, fontWeight: '800', color: '#1c1f1c' }, edit: { color: ACCENT, fontWeight: '800', fontSize: 15 }, profile: { alignItems: 'center', paddingVertical: 22 }, profileName: { fontSize: 27, fontWeight: '900', color: '#171a17', marginTop: 13 }, profileSub: { color: '#7b807b', marginTop: 6 }, summaryCard: { backgroundColor: '#173f36', borderRadius: 22, paddingVertical: 19, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 12 }, summaryValue: { color: '#fff', fontSize: 17, fontWeight: '900', textAlign: 'center' }, summaryLabel: { color: '#a9c0ba', fontSize: 11, marginTop: 5, textAlign: 'center' }, divider: { width: StyleSheet.hairlineWidth, height: 35, backgroundColor: '#719087' }, infoCard: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 18, marginBottom: 12, borderWidth: 1, borderColor: '#e3e6e2' }, infoRow: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e4e6e3' }, infoLabel: { color: '#878c87', fontSize: 12, marginBottom: 6 }, infoValue: { color: '#252925', fontSize: 15, lineHeight: 21, fontWeight: '600' },
  visitCard: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 20, padding: 14, marginBottom: 11, borderWidth: 1, borderColor: '#e2e5e1' }, visitDate: { color: ACCENT, fontSize: 11, fontWeight: '800' }, visitService: { color: '#1e211e', fontSize: 16, fontWeight: '900', marginTop: 5 }, visitMemo: { color: '#777c78', fontSize: 12, lineHeight: 17, marginTop: 5 }, visitPrice: { color: '#333833', fontWeight: '800', fontSize: 13, marginTop: 7 }, nextVisit: { color: '#a45c3d', fontWeight: '700', fontSize: 12, marginTop: 7 }, visitActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e5e1' }, visitEdit: { color: ACCENT, fontSize: 13, fontWeight: '900' }, visitDelete: { color: '#bc554c', fontSize: 13, fontWeight: '900' },
  modalSafe: { flex: 1, backgroundColor: BG }, modalTop: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d8dbd7' }, modalClose: { color: ACCENT, fontSize: 15, fontWeight: '700' }, modalTitle: { fontSize: 17, fontWeight: '900', color: '#1c1f1c' }, modalContent: { padding: 20, paddingBottom: 50 }, fieldWrap: { marginBottom: 17 }, label: { color: '#343834', fontSize: 13, fontWeight: '800', marginBottom: 8 }, input: { backgroundColor: '#fff', minHeight: 53, borderRadius: 16, borderWidth: 1, borderColor: '#dfe2de', paddingHorizontal: 15, fontSize: 16, color: '#202420' }, textarea: { minHeight: 104, paddingTop: 14, textAlignVertical: 'top' }, moneyRow: { flexDirection: 'row', gap: 10 }, fieldHelp: { color: '#7b817c', fontSize: 12, lineHeight: 18, marginTop: -10, marginBottom: 17 }, segment: { flexDirection: 'row', backgroundColor: '#e9ece8', padding: 4, borderRadius: 16, marginBottom: 18 }, segmentButton: { flex: 1, height: 45, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, segmentActive: { backgroundColor: ACCENT }, segmentText: { color: '#767c77', fontSize: 15, fontWeight: '800' }, segmentTextActive: { color: '#fff' }, dateField: { backgroundColor: '#fff', minHeight: 56, borderRadius: 16, borderWidth: 1, borderColor: '#dfe2de', paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, dateFieldText: { color: '#202420', fontSize: 16, fontWeight: '600' }, dateFieldPlaceholder: { color: '#a4a7a3', fontWeight: '400' }, dateFieldIcon: { color: ACCENT, fontSize: 20 },
  calendarCard: { backgroundColor: '#fff', borderRadius: 22, padding: 12, borderWidth: 1, borderColor: '#e2e5e1' }, weekRow: { flexDirection: 'row', marginBottom: 5 }, weekLabel: { width: '14.285%', textAlign: 'center', color: '#737973', fontSize: 12, fontWeight: '800', paddingVertical: 7 }, sunday: { color: '#bc554c' }, calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' }, dayCell: { width: '14.285%', height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }, dayCellActive: { backgroundColor: ACCENT }, dayNumberWrap: { height: 21, minWidth: 24, alignItems: 'center', justifyContent: 'flex-start' }, dayText: { color: '#272b27', fontSize: 14, lineHeight: 17, fontWeight: '700' }, dayMuted: { color: '#c4c7c4' }, dayToday: { fontWeight: '900' }, todayIndicator: { position: 'absolute', bottom: 0, width: 14, height: 2, borderRadius: 1, backgroundColor: '#252925' }, todayIndicatorActive: { backgroundColor: '#fff' }, dayTextActive: { color: '#fff' }, dayMarkers: { height: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }, dayBadge: { minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: '#dfece7', alignItems: 'center', justifyContent: 'center' }, dayBadgeActive: { backgroundColor: '#fff' }, dayBadgeText: { color: ACCENT, fontSize: 9, fontWeight: '900' }, dayBadgeTextActive: { color: ACCENT }, noteDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#b15f3b' }, noteDotActive: { backgroundColor: '#fff' }, calendarSummary: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#173f36', borderRadius: 20, padding: 17, marginTop: 12, marginBottom: 14 }, calendarSummaryLabel: { color: '#a9c0ba', fontSize: 10, textAlign: 'center' }, calendarSummaryValue: { color: '#fff', fontSize: 13, fontWeight: '900', marginTop: 5, textAlign: 'center' },
  daySectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, smallAdd: { backgroundColor: '#e1ece7', borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9 }, smallAddText: { color: ACCENT, fontSize: 12, fontWeight: '900' }, pickerBackdrop: { flex: 1, backgroundColor: 'rgba(17,25,21,0.35)', justifyContent: 'flex-end' }, customerPicker: { maxHeight: '70%', backgroundColor: BG, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 40 }, customerPickerTitle: { color: '#171a17', fontSize: 23, fontWeight: '900' }, customerPickerSub: { color: '#777d78', fontSize: 13, marginTop: 5, marginBottom: 18 }, pickerCustomer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 17, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: '#e2e5e1' }, datePickerPanel: { backgroundColor: BG, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 34 }, datePickerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, datePickerTitle: { fontSize: 22, fontWeight: '900', color: '#171a17' }, datePickerClose: { fontSize: 34, color: '#4f5550', fontWeight: '300' }, datePickerMonth: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 }, datePickerDay: { width: '14.285%', height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, datePickerActions: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 12 }, noteCard: { backgroundColor: '#fff', borderRadius: 17, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#e2e5e1' }, noteText: { color: '#282c28', fontSize: 14, lineHeight: 21 }, noteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 12 }, noteEdit: { color: ACCENT, fontSize: 13, fontWeight: '800' }, noteDelete: { color: '#bc554c', fontSize: 13, fontWeight: '800' },
  lockScreen: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: 30 }, lockLogo: { color: '#173f36', fontSize: 44, lineHeight: 43, letterSpacing: -2, fontWeight: '900', textAlign: 'center' }, lockText: { color: '#737973', marginTop: 24, marginBottom: 20 },
});
