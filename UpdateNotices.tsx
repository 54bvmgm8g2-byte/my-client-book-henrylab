import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import appConfig from './app.json';

export const APP_VERSION = appConfig.expo.version;
const SEEN_KEY = 'my-client-book-update-notice-seen';

// Add an entry matching app.json's version for each release. Keep older entries for Settings.
const RELEASES = [
  {
    version: '1.1.2',
    changes: [
      '고객 목록을 먼저 등록한 순서대로 표시해요. 고객 정보를 수정해도 등록 순서는 유지돼요.',
      '이름, 전화번호, 선호 스타일뿐 아니라 고객 메모에 적은 내용도 검색할 수 있어요.',
      '고객 목록에서 메모를 한 줄로 미리 보고, 검색할 때는 검색어가 포함된 부분을 확인할 수 있어요.',
      '새 버전의 변경사항을 처음 실행할 때 안내해요. 설정의 업데이트 내역에서 언제든 다시 확인할 수 있어요.',
    ],
  },
  {
    version: '1.1.1',
    changes: [
      '등록한 방문 기록을 수정하거나 개별 삭제할 수 있어요.',
      '콜백 상태를 연락완료 또는 미연락으로 변경할 수 있어요.',
      '연락완료 목록은 가장 최근에 완료 처리한 고객부터 표시해요.',
      '설정에서 고객목록과 방문기록을 확인용 Excel 파일로 내보낼 수 있어요.',
    ],
  },
];

export function UpdateNotices({ historyOpen, onCloseHistory, available }: {
  historyOpen: boolean;
  onCloseHistory: () => void;
  available: boolean;
}) {
  const [unseen, setUnseen] = useState(false);
  const latest = RELEASES.find((release) => release.version === APP_VERSION);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SEEN_KEY)
      .then((seen) => { if (active) setUnseen(Boolean(latest) && seen !== APP_VERSION); })
      .catch(() => { if (active) setUnseen(Boolean(latest)); });
    return () => { active = false; };
  }, [latest]);

  const close = () => {
    if (unseen) {
      setUnseen(false);
      void AsyncStorage.setItem(SEEN_KEY, APP_VERSION).catch(() => {
        // Do not block access to customer records if the device cannot save preferences.
        console.warn('Could not save update notice acknowledgement.');
      });
    }
    onCloseHistory();
  };
  const entries = historyOpen ? RELEASES : latest ? [latest] : [];

  return (
    <Modal visible={available && (historyOpen || unseen)} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>{historyOpen ? '업데이트 내역' : '새롭게 달라졌어요'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="업데이트 안내 닫기" onPress={close} hitSlop={12}><Text style={styles.close}>닫기</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.subtitle}>MY CLIENT BOOK · 현재 버전 {APP_VERSION}</Text>
          {entries.map((release) => (
            <View key={release.version} style={styles.card}>
              <Text accessibilityRole="header" style={styles.version}>버전 {release.version}</Text>
              {release.changes.map((change) => <Text key={change} style={styles.change}>• {change}</Text>)}
            </View>
          ))}
          {!historyOpen && <Text style={styles.hint}>설정 → 업데이트 내역에서 다시 확인할 수 있어요.</Text>}
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={close} style={styles.button}><Text style={styles.buttonText}>확인</Text></Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f5f2' },
  header: { padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontSize: 23, fontWeight: '800', color: '#202420' },
  close: { fontSize: 16, fontWeight: '700', color: '#1f6f5c' },
  content: { padding: 20, paddingTop: 0, paddingBottom: 30 },
  subtitle: { color: '#626962', fontSize: 14, marginBottom: 20 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 20, marginBottom: 16 },
  version: { color: '#1f6f5c', fontSize: 18, fontWeight: '800', marginBottom: 10 },
  change: { color: '#343834', fontSize: 16, lineHeight: 25, marginVertical: 7 },
  hint: { color: '#626962', fontSize: 14, lineHeight: 22 },
  button: { backgroundColor: '#1f6f5c', borderRadius: 16, padding: 17, margin: 20, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
