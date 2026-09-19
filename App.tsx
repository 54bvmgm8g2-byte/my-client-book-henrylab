import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
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

type Category = '남성' | '여성' | '기타';
type Customer = {
  id: string;
  name: string;
  phoneLast4: string;
  category: Category;
  preferredStyle: string;
  notes: string;
  revisitDays: number;
  createdAt: string;
};
type Visit = {
  id: string;
  customerId: string;
  date: string;
  service: string;
  memo: string;
  price: number;
  discount: number;
  productSales: number;
  photoUri?: string;
  callbackDone?: boolean;
};
type AppData = { customers: Customer[]; visits: Visit[] };
type Tab = 'home' | 'customers' | 'callbacks' | 'stats' | 'settings';

const STORAGE_KEY = 'my-client-book-v3-data';
const SETTINGS_KEY = 'my-client-book-v3-settings';
const ACCENT = '#1f6f5c';
const BG = '#f4f5f2';

const todayIso = () => new Date().toISOString().slice(0, 10);
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const money = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
const parseMoney = (value: string) => Number(value.replace(/[^0-9]/g, '')) || 0;
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const monthKey = (iso = todayIso()) => iso.slice(0, 7);

function AppButton({ label, onPress, secondary = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', multiline = false }: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: 'default' | 'number-pad'; multiline?: boolean }) {
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
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  );
}

function Header({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.eyebrow}>MY CLIENT BOOK</Text>
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
  const [data, setData] = useState<AppData>({ customers: [], visits: [] });
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showVisit, setShowVisit] = useState(false);
  const [faceIdEnabled, setFaceIdEnabled] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [raw, settings] = await Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(SETTINGS_KEY)]);
        if (raw) setData(JSON.parse(raw));
        if (settings) {
          const parsed = JSON.parse(settings);
          setFaceIdEnabled(Boolean(parsed.faceIdEnabled));
          setLocked(Boolean(parsed.faceIdEnabled));
        }
      } catch {
        Alert.alert('데이터를 불러오지 못했어요', '백업 파일이 있다면 설정에서 복원할 수 있어요.');
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (loaded) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, loaded]);

  const unlock = async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'MY CLIENT BOOK 잠금 해제', cancelLabel: '취소' });
    if (result.success) setLocked(false);
  };

  if (!loaded) return <SafeAreaView style={styles.center}><Text style={styles.subtitle}>고객 장부를 준비하고 있어요.</Text></SafeAreaView>;
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
    setData((prev) => ({ ...prev, customers: [...prev.customers.filter((c) => c.id !== customer.id), customer] }));
    setSelectedId(customer.id);
    setShowCustomer(false);
  };
  const saveVisit = (visit: Visit) => {
    setData((prev) => ({ ...prev, visits: [...prev.visits.filter((v) => v.id !== visit.id), visit] }));
    setShowVisit(false);
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
            onVisit={() => setShowVisit(true)}
            onDelete={() => Alert.alert('고객을 삭제할까요?', '방문 기록도 함께 삭제되며 복구할 수 없어요.', [
              { text: '취소', style: 'cancel' },
              { text: '삭제', style: 'destructive', onPress: () => { setData((p) => ({ customers: p.customers.filter((c) => c.id !== selected.id), visits: p.visits.filter((v) => v.customerId !== selected.id) })); setSelectedId(null); } },
            ])}
          />
        ) : (
          <>
            <View style={styles.content}>
              {tab === 'home' && <Home data={data} onOpenCustomer={setSelectedId} onAdd={() => setShowCustomer(true)} />}
              {tab === 'customers' && <Customers customers={data.customers} visits={data.visits} onOpen={setSelectedId} onAdd={() => setShowCustomer(true)} />}
              {tab === 'callbacks' && <Callbacks data={data} onOpen={setSelectedId} onDone={(visitId) => setData((p) => ({ ...p, visits: p.visits.map((v) => v.id === visitId ? { ...v, callbackDone: true } : v) }))} />}
              {tab === 'stats' && <Stats data={data} />}
              {tab === 'settings' && <Settings data={data} setData={setData} faceIdEnabled={faceIdEnabled} setFaceIdEnabled={setFaceIdEnabled} />}
            </View>
            <Nav tab={tab} setTab={setTab} />
          </>
        )}
      </View>
      <CustomerEditor visible={showCustomer} initial={selected} onClose={() => setShowCustomer(false)} onSave={saveCustomer} />
      {selected && <VisitEditor visible={showVisit} customer={selected} onClose={() => setShowVisit(false)} onSave={saveVisit} />}
    </SafeAreaView>
  );
}

function Home({ data, onOpenCustomer, onAdd }: { data: AppData; onOpenCustomer: (id: string) => void; onAdd: () => void }) {
  const currentMonth = monthKey();
  const monthVisits = data.visits.filter((v) => monthKey(v.date) === currentMonth);
  const revenue = monthVisits.reduce((sum, v) => sum + v.price - v.discount + v.productSales, 0);
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
        return <Pressable key={visit.id} onPress={() => onOpenCustomer(customer.id)} style={styles.rowCard}><Avatar name={customer.name} /><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{customer.name}</Text><Text style={styles.rowSub}>{visit.service} · {visit.date}</Text></View><Text style={styles.rowPrice}>{money(visit.price - visit.discount + visit.productSales)}</Text></Pressable>;
      })}
    </ScrollView>
  );
}

function Customers({ customers, visits, onOpen, onAdd }: { customers: Customer[]; visits: Visit[]; onOpen: (id: string) => void; onAdd: () => void }) {
  const [query, setQuery] = useState('');
  const filtered = customers.filter((c) => `${c.name} ${c.phoneLast4} ${c.preferredStyle}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return (
    <View style={styles.screen}>
      <Header title="고객" subtitle={`${customers.length}명의 고객이 기록되어 있어요.`} action={<Pressable onPress={onAdd} style={styles.circleButton}><Text style={styles.circleButtonText}>＋</Text></Pressable>} />
      <TextInput value={query} onChangeText={setQuery} placeholder="이름, 연락처 뒤 4자리, 스타일 검색" placeholderTextColor="#969a96" style={styles.search} />
      {filtered.length === 0 ? <Empty title={query ? '검색 결과가 없어요' : '등록된 고객이 없어요'} description={query ? '이름이나 연락처를 다시 확인해주세요.' : '고객을 등록하면 방문 이력을 바로 연결할 수 있어요.'} actionLabel={query ? undefined : '고객 등록'} onAction={query ? undefined : onAdd} /> : (
        <FlatList data={filtered} keyExtractor={(c) => c.id} contentContainerStyle={{ paddingBottom: 30 }} renderItem={({ item }) => {
          const count = visits.filter((v) => v.customerId === item.id).length;
          return <Pressable onPress={() => onOpen(item.id)} style={styles.customerCard}><Avatar name={item.name} large /><View style={{ flex: 1 }}><Text style={styles.customerName}>{item.name}</Text><Text style={styles.rowSub}>{item.phoneLast4 ? `•••• ${item.phoneLast4}` : '연락처 미입력'} · {item.preferredStyle || item.category}</Text></View><View style={styles.countBadge}><Text style={styles.countText}>{count}회</Text></View></Pressable>;
        }} />
      )}
    </View>
  );
}

function getCallbacks(data: AppData) {
  const today = todayIso();
  return data.customers.map((customer) => {
    const visit = data.visits.filter((v) => v.customerId === customer.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!visit) return null;
    return { customer, visit, dueDate: addDays(visit.date, customer.revisitDays) };
  }).filter((x): x is NonNullable<typeof x> => Boolean(x && x.dueDate <= today)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function Callbacks({ data, onOpen, onDone }: { data: AppData; onOpen: (id: string) => void; onDone: (visitId: string) => void }) {
  const items = getCallbacks(data).filter((x) => !x.visit.callbackDone);
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Header title="콜백" subtitle="재방문 주기에 맞춰 먼저 연락할 고객이에요." />
      {items.length === 0 ? <Empty title="예정된 콜백이 없어요" description="방문 기록을 추가하면 고객별 재방문 주기에 맞춰 자동으로 표시돼요." /> : items.map(({ customer, visit, dueDate }) => (
        <View key={visit.id} style={styles.callbackCard}>
          <Pressable onPress={() => onOpen(customer.id)} style={styles.callbackMain}><Avatar name={customer.name} large /><View style={{ flex: 1 }}><Text style={styles.customerName}>{customer.name}</Text><Text style={styles.rowSub}>최근 {visit.service} · {visit.date}</Text><Text style={styles.callbackDue}>{dueDate < todayIso() ? `${dueDate}부터 연락 필요` : `오늘 연락 예정`}</Text></View></Pressable>
          <AppButton label="연락 완료" onPress={() => onDone(visit.id)} secondary />
        </View>
      ))}
    </ScrollView>
  );
}

function Stats({ data }: { data: AppData }) {
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7); }).reverse();
  const rows = months.map((month) => {
    const visits = data.visits.filter((v) => monthKey(v.date) === month);
    const revenue = visits.reduce((sum, v) => sum + v.price - v.discount + v.productSales, 0);
    return { month, visits: visits.length, revenue };
  });
  const current = rows[rows.length - 1];
  const max = Math.max(...rows.map((r) => r.revenue), 1);
  const unique = new Set(data.visits.filter((v) => monthKey(v.date) === monthKey()).map((v) => v.customerId)).size;
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Header title="통계" subtitle="감이 아니라 기록으로 고객 흐름을 확인하세요." />
      <View style={styles.statGrid}>
        <StatCard label="이번 달 매출" value={money(current.revenue)} />
        <StatCard label="이번 달 방문" value={`${current.visits}회`} />
        <StatCard label="방문 고객" value={`${unique}명`} />
        <StatCard label="평균 객단가" value={current.visits ? money(current.revenue / current.visits) : '0원'} />
      </View>
      <SectionTitle title="최근 6개월 매출" />
      <View style={styles.chartCard}>{rows.map((row) => <View key={row.month} style={styles.chartRow}><Text style={styles.chartLabel}>{Number(row.month.slice(5))}월</Text><View style={styles.chartTrack}><View style={[styles.chartBar, { width: `${Math.max(3, (row.revenue / max) * 100)}%` }]} /></View><Text style={styles.chartValue}>{row.revenue ? `${Math.round(row.revenue / 10000)}만` : '0'}</Text></View>)}</View>
    </ScrollView>
  );
}

function Settings({ data, setData, faceIdEnabled, setFaceIdEnabled }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>>; faceIdEnabled: boolean; setFaceIdEnabled: (v: boolean) => void }) {
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
  const reset = () => Alert.alert('모든 기록을 삭제할까요?', '이 작업은 되돌릴 수 없어요. 먼저 백업하는 것을 권장해요.', [{ text: '취소', style: 'cancel' }, { text: '전체 삭제', style: 'destructive', onPress: () => setData({ customers: [], visits: [] }) }]);
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Header title="설정" subtitle="고객 정보는 외부 서버로 전송되지 않아요." />
      <View style={styles.settingCard}><View style={{ flex: 1 }}><Text style={styles.settingTitle}>Face ID 잠금</Text><Text style={styles.settingSub}>앱을 열 때 고객 정보를 보호합니다.</Text></View><Switch value={faceIdEnabled} onValueChange={toggleFaceId} trackColor={{ true: ACCENT }} /></View>
      <Pressable onPress={backup} style={styles.settingCard}><View style={{ flex: 1 }}><Text style={styles.settingTitle}>데이터 백업</Text><Text style={styles.settingSub}>고객과 방문 기록을 파일로 안전하게 저장합니다.</Text></View><Text style={styles.chevron}>›</Text></Pressable>
      <View style={styles.privacyCard}><Text style={styles.privacyTitle}>로컬 저장 방식</Text><Text style={styles.privacyText}>회원가입 없이 사용할 수 있으며 고객 정보와 시술 기록은 이 기기에만 저장됩니다. 기기를 바꾸거나 앱을 삭제하기 전에 반드시 백업해주세요.</Text></View>
      <Pressable onPress={reset} style={styles.dangerButton}><Text style={styles.dangerText}>모든 데이터 삭제</Text></Pressable>
      <Text style={styles.version}>MY CLIENT BOOK 3.0 · HenryLAB</Text>
    </ScrollView>
  );
}

function CustomerDetail({ customer, visits, onBack, onEdit, onVisit, onDelete }: { customer: Customer; visits: Visit[]; onBack: () => void; onEdit: () => void; onVisit: () => void; onDelete: () => void }) {
  const total = visits.reduce((sum, v) => sum + v.price - v.discount + v.productSales, 0);
  return (
    <ScrollView contentContainerStyle={styles.detailScroll}>
      <View style={styles.detailTop}><Pressable onPress={onBack}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.detailTopTitle}>고객 상세</Text><Pressable onPress={onEdit}><Text style={styles.edit}>수정</Text></Pressable></View>
      <View style={styles.profile}><Avatar name={customer.name} xlarge /><Text style={styles.profileName}>{customer.name}</Text><Text style={styles.profileSub}>{customer.phoneLast4 ? `연락처 •••• ${customer.phoneLast4}` : '연락처 미입력'} · {customer.category}</Text></View>
      <View style={styles.summaryCard}><View><Text style={styles.summaryValue}>{visits.length}</Text><Text style={styles.summaryLabel}>방문</Text></View><View style={styles.divider} /><View><Text style={styles.summaryValue}>{money(total)}</Text><Text style={styles.summaryLabel}>누적 매출</Text></View><View style={styles.divider} /><View><Text style={styles.summaryValue}>{customer.revisitDays}일</Text><Text style={styles.summaryLabel}>재방문</Text></View></View>
      <View style={styles.infoCard}><Info label="선호 스타일" value={customer.preferredStyle || '미입력'} /><Info label="상담 메모" value={customer.notes || '미입력'} /></View>
      <AppButton label="새 방문 기록 추가" onPress={onVisit} />
      <SectionTitle title="방문 타임라인" count={visits.length} />
      {visits.length === 0 ? <Empty title="방문 기록이 없어요" description="첫 시술 기록을 남겨보세요." /> : visits.map((visit) => <View key={visit.id} style={styles.visitCard}>{visit.photoUri ? <Image source={{ uri: visit.photoUri }} style={styles.visitPhoto} /> : null}<View style={{ flex: 1 }}><Text style={styles.visitDate}>{visit.date}</Text><Text style={styles.visitService}>{visit.service}</Text>{!!visit.memo && <Text style={styles.visitMemo}>{visit.memo}</Text>}<Text style={styles.visitPrice}>{money(visit.price - visit.discount + visit.productSales)}</Text></View></View>)}
      <Pressable onPress={onDelete} style={styles.dangerButton}><Text style={styles.dangerText}>고객 삭제</Text></Pressable>
    </ScrollView>
  );
}

function CustomerEditor({ visible, initial, onClose, onSave }: { visible: boolean; initial: Customer | null; onClose: () => void; onSave: (c: Customer) => void }) {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [category, setCategory] = useState<Category>('남성'); const [style, setStyle] = useState(''); const [notes, setNotes] = useState(''); const [days, setDays] = useState('28');
  useEffect(() => { if (visible) { setName(initial?.name ?? ''); setPhone(initial?.phoneLast4 ?? ''); setCategory(initial?.category ?? '남성'); setStyle(initial?.preferredStyle ?? ''); setNotes(initial?.notes ?? ''); setDays(String(initial?.revisitDays ?? 28)); } }, [visible, initial]);
  const submit = () => { if (!name.trim()) return Alert.alert('고객 이름을 입력해주세요.'); onSave({ id: initial?.id ?? id(), name: name.trim(), phoneLast4: phone.replace(/[^0-9]/g, '').slice(-4), category, preferredStyle: style.trim(), notes: notes.trim(), revisitDays: Math.max(1, Number(days) || 28), createdAt: initial?.createdAt ?? new Date().toISOString() }); };
  return <EditorShell visible={visible} title={initial ? '고객 정보 수정' : '새 고객 등록'} onClose={onClose}><Field label="고객 이름 *" value={name} onChangeText={setName} placeholder="이름 또는 활동명" /><Field label="연락처 뒤 4자리" value={phone} onChangeText={setPhone} placeholder="0000" keyboardType="number-pad" /><Text style={styles.label}>구분</Text><View style={styles.segment}>{(['남성', '여성', '기타'] as Category[]).map((x) => <Pressable key={x} onPress={() => setCategory(x)} style={[styles.segmentItem, category === x && styles.segmentActive]}><Text style={[styles.segmentText, category === x && styles.segmentTextActive]}>{x}</Text></Pressable>)}</View><Field label="선호 스타일" value={style} onChangeText={setStyle} placeholder="예: 슬릭컷, 하이레이어드" /><Field label="재방문 주기" value={days} onChangeText={setDays} placeholder="28" keyboardType="number-pad" /><Field label="상담 및 특이사항" value={notes} onChangeText={setNotes} placeholder="모질, 두피 상태, 선호도 등을 기록하세요." multiline /><AppButton label={initial ? '수정 완료' : '고객 등록'} onPress={submit} /></EditorShell>;
}

function VisitEditor({ visible, customer, onClose, onSave }: { visible: boolean; customer: Customer; onClose: () => void; onSave: (v: Visit) => void }) {
  const [date, setDate] = useState(todayIso()); const [service, setService] = useState(''); const [memo, setMemo] = useState(''); const [price, setPrice] = useState(''); const [discount, setDiscount] = useState(''); const [product, setProduct] = useState(''); const [photoUri, setPhotoUri] = useState<string | undefined>();
  useEffect(() => { if (visible) { setDate(todayIso()); setService(''); setMemo(''); setPrice(''); setDiscount(''); setProduct(''); setPhotoUri(undefined); } }, [visible]);
  const choosePhoto = () => Alert.alert('시술 사진 추가', '사진을 가져올 방법을 선택해주세요.', [{ text: '카메라', onPress: async () => { const r = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true }); if (!r.canceled) setPhotoUri(r.assets[0].uri); } }, { text: '보관함', onPress: async () => { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true }); if (!r.canceled) setPhotoUri(r.assets[0].uri); } }, { text: '취소', style: 'cancel' }]);
  const submit = () => { if (!service.trim()) return Alert.alert('시술명을 입력해주세요.'); onSave({ id: id(), customerId: customer.id, date, service: service.trim(), memo: memo.trim(), price: parseMoney(price), discount: parseMoney(discount), productSales: parseMoney(product), photoUri }); };
  return <EditorShell visible={visible} title={`${customer.name} 방문 기록`} onClose={onClose}><Field label="방문일 *" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" /><Field label="시술명 *" value={service} onChangeText={setService} placeholder="예: 디자인컷 + 다운펌" /><View style={styles.moneyRow}><View style={{ flex: 1 }}><Field label="시술 금액" value={price} onChangeText={setPrice} placeholder="0" keyboardType="number-pad" /></View><View style={{ flex: 1 }}><Field label="할인" value={discount} onChangeText={setDiscount} placeholder="0" keyboardType="number-pad" /></View></View><Field label="제품 판매" value={product} onChangeText={setProduct} placeholder="0" keyboardType="number-pad" /><Field label="시술 메모" value={memo} onChangeText={setMemo} placeholder="약제, 배합, 디자인 포인트 등을 기록하세요." multiline /><Pressable onPress={choosePhoto} style={styles.photoPicker}>{photoUri ? <Image source={{ uri: photoUri }} style={styles.photoPreview} /> : <><Text style={styles.photoPlus}>＋</Text><Text style={styles.photoText}>시술 사진 추가</Text></>}</Pressable><AppButton label="방문 기록 저장" onPress={submit} /></EditorShell>;
}

function EditorShell({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><SafeAreaView style={styles.modalSafe}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={styles.modalTop}><Pressable onPress={onClose}><Text style={styles.modalClose}>취소</Text></Pressable><Text style={styles.modalTitle}>{title}</Text><View style={{ width: 36 }} /></View><ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">{children}</ScrollView></KeyboardAvoidingView></SafeAreaView></Modal>;
}

function Nav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { key: Tab; icon: string; label: string }[] = [{ key: 'home', icon: '⌂', label: '홈' }, { key: 'customers', icon: '♙', label: '고객' }, { key: 'callbacks', icon: '◷', label: '콜백' }, { key: 'stats', icon: '▥', label: '통계' }, { key: 'settings', icon: '•••', label: '설정' }];
  return <View style={styles.nav}>{items.map((item) => <Pressable key={item.key} onPress={() => setTab(item.key)} style={styles.navItem}><Text style={[styles.navIcon, tab === item.key && styles.navActive]}>{item.icon}</Text><Text style={[styles.navLabel, tab === item.key && styles.navActive]}>{item.label}</Text></Pressable>)}</View>;
}

function Avatar({ name, large = false, xlarge = false }: { name: string; large?: boolean; xlarge?: boolean }) { return <View style={[styles.avatar, large && styles.avatarLarge, xlarge && styles.avatarXL]}><Text style={[styles.avatarText, (large || xlarge) && { fontSize: xlarge ? 30 : 20 }]}>{name.trim().slice(0, 1) || '?'}</Text></View>; }
function SectionTitle({ title, count }: { title: string; count?: number }) { return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text>{typeof count === 'number' && <Text style={styles.sectionCount}>{count}</Text>}</View>; }
function StatCard({ label, value }: { label: string; value: string }) { return <View style={styles.statCard}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>; }
function Info({ label, value }: { label: string; value: string }) { return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG }, app: { flex: 1 }, content: { flex: 1 }, screen: { flex: 1, paddingHorizontal: 20, paddingTop: 18 }, scroll: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 36 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 22 }, eyebrow: { color: ACCENT, fontSize: 12, fontWeight: '800', letterSpacing: 2.2, marginBottom: 6 }, title: { color: '#151815', fontSize: 31, fontWeight: '800', letterSpacing: -1 }, subtitle: { color: '#747a75', fontSize: 14, lineHeight: 21, marginTop: 7 },
  circleButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e0e3de' }, circleButtonText: { fontSize: 28, color: ACCENT, fontWeight: '300', marginTop: -2 },
  heroCard: { backgroundColor: '#173f36', borderRadius: 25, padding: 24, marginBottom: 26 }, heroLabel: { color: '#b9d1ca', fontSize: 13, fontWeight: '700' }, heroValue: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 8, letterSpacing: -1 }, heroRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#57766e' }, heroMiniValue: { color: '#fff', fontSize: 18, fontWeight: '800' }, heroMiniLabel: { color: '#a8c0ba', fontSize: 12, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 12 }, sectionTitle: { fontSize: 20, fontWeight: '800', color: '#181b18' }, sectionCount: { marginLeft: 8, color: ACCENT, fontWeight: '800' }, rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 18, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#e6e8e4' }, rowTitle: { color: '#1b1e1b', fontWeight: '800', fontSize: 16 }, rowSub: { color: '#7c817d', fontSize: 13, marginTop: 4 }, rowPrice: { color: '#333833', fontWeight: '700', fontSize: 13 }, dueText: { color: '#b15f3b', fontWeight: '800', fontSize: 13 },
  avatar: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#dcebe5', alignItems: 'center', justifyContent: 'center', marginRight: 12 }, avatarLarge: { width: 54, height: 54, borderRadius: 19 }, avatarXL: { width: 82, height: 82, borderRadius: 28, marginRight: 0 }, avatarText: { color: ACCENT, fontWeight: '900', fontSize: 17 },
  button: { minHeight: 54, borderRadius: 17, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginVertical: 5 }, buttonSecondary: { backgroundColor: '#edf3f0' }, buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' }, buttonTextSecondary: { color: ACCENT }, pressed: { opacity: 0.72 }, disabled: { opacity: 0.4 },
  empty: { backgroundColor: '#fff', padding: 28, borderRadius: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e4e7e2', marginTop: 8 }, emptyMark: { color: ACCENT, fontSize: 42, fontWeight: '200' }, emptyTitle: { fontSize: 19, fontWeight: '800', color: '#1b1e1b', marginTop: 8 }, emptyText: { color: '#7b807b', textAlign: 'center', lineHeight: 20, marginVertical: 10 }, slimEmpty: { padding: 18, borderRadius: 16, backgroundColor: '#e9eeea', marginBottom: 15 }, slimEmptyText: { color: '#737a74', textAlign: 'center' },
  search: { backgroundColor: '#fff', minHeight: 52, borderRadius: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: '#e0e3df', marginBottom: 14, fontSize: 15 }, customerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 11, borderWidth: 1, borderColor: '#e4e7e3' }, customerName: { fontSize: 17, fontWeight: '800', color: '#1b1e1b' }, countBadge: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#edf3f0', borderRadius: 10 }, countText: { color: ACCENT, fontSize: 12, fontWeight: '800' },
  callbackCard: { backgroundColor: '#fff', borderRadius: 22, padding: 17, marginBottom: 12, borderWidth: 1, borderColor: '#e3e6e2' }, callbackMain: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 }, callbackDue: { color: '#b15f3b', fontWeight: '700', fontSize: 12, marginTop: 7 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, statCard: { width: '48.5%', backgroundColor: '#fff', borderRadius: 20, padding: 18, marginBottom: 10, minHeight: 105, justifyContent: 'space-between', borderWidth: 1, borderColor: '#e3e6e2' }, statLabel: { color: '#777d78', fontSize: 13 }, statValue: { color: '#1b1e1b', fontSize: 19, fontWeight: '900', letterSpacing: -0.5 }, chartCard: { backgroundColor: '#fff', borderRadius: 22, padding: 18, borderWidth: 1, borderColor: '#e3e6e2' }, chartRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 9 }, chartLabel: { width: 32, color: '#727772', fontSize: 12 }, chartTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: '#e9ece8', overflow: 'hidden' }, chartBar: { height: 10, borderRadius: 5, backgroundColor: ACCENT }, chartValue: { width: 43, textAlign: 'right', color: '#555b56', fontSize: 11, fontWeight: '700' },
  settingCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 19, padding: 18, marginBottom: 10, borderWidth: 1, borderColor: '#e4e7e2' }, settingTitle: { color: '#1c1f1c', fontSize: 16, fontWeight: '800' }, settingSub: { color: '#7d827e', fontSize: 12, marginTop: 5, lineHeight: 17 }, chevron: { color: '#8b908c', fontSize: 28 }, privacyCard: { backgroundColor: '#e5eee9', borderRadius: 20, padding: 19, marginVertical: 12 }, privacyTitle: { color: '#244a40', fontWeight: '900', fontSize: 15 }, privacyText: { color: '#587067', lineHeight: 20, fontSize: 13, marginTop: 8 }, dangerButton: { paddingVertical: 17, alignItems: 'center', marginTop: 20 }, dangerText: { color: '#bc554c', fontSize: 14, fontWeight: '800' }, version: { textAlign: 'center', color: '#a1a5a1', fontSize: 11, marginTop: 20 },
  nav: { height: 76, backgroundColor: '#fff', flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d9dcd8', paddingBottom: 6 }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' }, navIcon: { color: '#9a9e9a', fontSize: 19, fontWeight: '700', height: 25 }, navLabel: { color: '#929792', fontSize: 10, fontWeight: '700', marginTop: 3 }, navActive: { color: ACCENT },
  detailScroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }, detailTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 54 }, back: { fontSize: 40, color: '#242824', fontWeight: '300' }, detailTopTitle: { fontSize: 16, fontWeight: '800', color: '#1c1f1c' }, edit: { color: ACCENT, fontWeight: '800', fontSize: 15 }, profile: { alignItems: 'center', paddingVertical: 22 }, profileName: { fontSize: 27, fontWeight: '900', color: '#171a17', marginTop: 13 }, profileSub: { color: '#7b807b', marginTop: 6 }, summaryCard: { backgroundColor: '#173f36', borderRadius: 22, paddingVertical: 19, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 12 }, summaryValue: { color: '#fff', fontSize: 17, fontWeight: '900', textAlign: 'center' }, summaryLabel: { color: '#a9c0ba', fontSize: 11, marginTop: 5, textAlign: 'center' }, divider: { width: StyleSheet.hairlineWidth, height: 35, backgroundColor: '#719087' }, infoCard: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 18, marginBottom: 12, borderWidth: 1, borderColor: '#e3e6e2' }, infoRow: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e4e6e3' }, infoLabel: { color: '#878c87', fontSize: 12, marginBottom: 6 }, infoValue: { color: '#252925', fontSize: 15, lineHeight: 21, fontWeight: '600' },
  visitCard: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 20, padding: 14, marginBottom: 11, borderWidth: 1, borderColor: '#e2e5e1' }, visitPhoto: { width: 92, height: 92, borderRadius: 14, marginRight: 14, backgroundColor: '#e8eae7' }, visitDate: { color: ACCENT, fontSize: 11, fontWeight: '800' }, visitService: { color: '#1e211e', fontSize: 16, fontWeight: '900', marginTop: 5 }, visitMemo: { color: '#777c78', fontSize: 12, lineHeight: 17, marginTop: 5 }, visitPrice: { color: '#333833', fontWeight: '800', fontSize: 13, marginTop: 7 },
  modalSafe: { flex: 1, backgroundColor: BG }, modalTop: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d8dbd7' }, modalClose: { color: ACCENT, fontSize: 15, fontWeight: '700' }, modalTitle: { fontSize: 17, fontWeight: '900', color: '#1c1f1c' }, modalContent: { padding: 20, paddingBottom: 50 }, fieldWrap: { marginBottom: 17 }, label: { color: '#343834', fontSize: 13, fontWeight: '800', marginBottom: 8 }, input: { backgroundColor: '#fff', minHeight: 53, borderRadius: 16, borderWidth: 1, borderColor: '#dfe2de', paddingHorizontal: 15, fontSize: 16, color: '#202420' }, textarea: { minHeight: 104, paddingTop: 14, textAlignVertical: 'top' }, segment: { flexDirection: 'row', backgroundColor: '#e7e9e6', borderRadius: 15, padding: 4, marginBottom: 17 }, segmentItem: { flex: 1, minHeight: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, segmentActive: { backgroundColor: '#fff' }, segmentText: { color: '#787d78', fontWeight: '700' }, segmentTextActive: { color: ACCENT, fontWeight: '900' }, moneyRow: { flexDirection: 'row', gap: 10 }, photoPicker: { minHeight: 130, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#aab9b2', borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 18, backgroundColor: '#edf2ef' }, photoPlus: { fontSize: 34, color: ACCENT, fontWeight: '200' }, photoText: { color: ACCENT, fontWeight: '800', marginTop: 5 }, photoPreview: { width: '100%', height: 190 },
  lockScreen: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: 30 }, lockLogo: { color: '#173f36', fontSize: 44, lineHeight: 43, letterSpacing: -2, fontWeight: '900', textAlign: 'center' }, lockText: { color: '#737973', marginTop: 24, marginBottom: 20 },
});
