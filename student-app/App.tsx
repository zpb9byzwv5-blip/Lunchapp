import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const TOKEN_KEY = 'school_lunch_jwt';

async function saveToken(token: string) {
  if (Platform.OS === 'web') {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
}

async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(TOKEN_KEY);
  }
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

async function clearToken() {
  if (Platform.OS === 'web') {
    localStorage.removeItem(TOKEN_KEY);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

interface MenuItem {
  id: string;
  course_type: 'MAIN' | 'DRINK';
  dish_name: string;
  price_pence: number;
  stock_remaining: number;
}

interface StudentProfile {
  id: string;
  fullName: string;
  yearGroup: string;
  isFsm: boolean;
  walletPence: number;
  fsmAllowancePence: number;
}

interface ExistingOrder {
  id: string;
  summary_text: string;
  subtotal_pence: number;
  fsm_covered_pence: number;
  wallet_charged_pence: number;
  status: 'PLACED' | 'COLLECTED';
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [emailInput, setEmailInput] = useState('');
  const [pinInput, setPinInput] = useState('');

  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [mains, setMains] = useState<MenuItem[]>([]);
  const [drinks, setDrinks] = useState<MenuItem[]>([]);
  const [existingOrder, setExistingOrder] = useState<ExistingOrder | null>(null);

  const [selectedMainId, setSelectedMainId] = useState<string | null>(null);
  const [selectedDrinkId, setSelectedDrinkId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const saved = await getToken();
      if (saved) {
        setToken(saved);
        await fetchTodayData(saved);
      } else {
        setLoading(false);
      }
    })();
  }, []);

  const fetchTodayData = async (activeToken: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/me/today`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });

      if (res.status === 401) {
        await handleLogout();
        return;
      }

      const data = await res.json();
      if (res.ok && data.student) {
        setStudent(data.student);
        setMains(Array.isArray(data.mains) ? data.mains : []);
        setDrinks(Array.isArray(data.drinks) ? data.drinks : []);
        setExistingOrder(data.existingOrder ?? null);
      }
    } catch {
      Alert.alert('Connection Error', 'Could not reach the school lunch server.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!emailInput.trim() || !pinInput.trim()) {
      Alert.alert('Missing Details', 'Enter your school email and 4-digit PIN.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput.trim().toLowerCase(),
          pinCode: pinInput.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.token) {
        Alert.alert('Login Failed', data.error || 'Check your email and PIN.');
        return;
      }

      await saveToken(data.token);
      setToken(data.token);
      await fetchTodayData(data.token);
    } catch {
      Alert.alert('Network Error', 'Unable to connect to school server.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await clearToken();
    setToken(null);
    setStudent(null);
    setSelectedMainId(null);
    setSelectedDrinkId(null);
    setLoading(false);
  };

  const handlePlaceOrder = async () => {
    if (!token || !student || (!selectedMainId && !selectedDrinkId)) return;
    try {
      setSubmitting(true);
      const res = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: student.id,
          mainItemId: selectedMainId,
          drinkItemId: selectedDrinkId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        Alert.alert('Order Not Placed', data.error || 'Please try again.');
        return;
      }
      await fetchTodayData(token);
    } catch {
      Alert.alert('Network Error', 'Please check your Wi-Fi or mobile data.');
    } finally {
      setSubmitting(false);
    }
  };

  const subtotalPence = (selectedMainId ? 265 : 0) + (selectedDrinkId ? 100 : 0);
  const fsmAvailablePence = student?.isFsm ? 265 : 0;
  const fsmAppliedPence = Math.min(subtotalPence, fsmAvailablePence);
  const walletDuePence = Math.max(0, subtotalPence - fsmAppliedPence);

  if (loading) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </SafeAreaView>
    );
  }

  if (!token || !student) {
    return (
      <SafeAreaView style={styles.loginContainer}>
        <View style={styles.loginCard}>
          <Text style={styles.loginTitle}>School Lunch Pre-Order</Text>
          <Text style={styles.loginSubtitle}>
            Sign in once with your school email and 4-digit catering PIN
          </Text>

          <Text style={styles.inputLabel}>School Email Address</Text>
          <TextInput
            style={styles.textInput}
            placeholder="alex.smith@school.sch.uk"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            keyboardType="email-address"
            value={emailInput}
            onChangeText={setEmailInput}
          />

          <Text style={styles.inputLabel}>4-Digit PIN</Text>
          <TextInput
            style={styles.textInput}
            placeholder="1234"
            placeholderTextColor="#94a3b8"
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
            value={pinInput}
            onChangeText={setPinInput}
          />

          <TouchableOpacity
            disabled={submitting}
            onPress={handleLogin}
            style={styles.orderButton}
          >
            <Text style={styles.orderButtonText}>
              {submitting ? 'Signing In...' : 'Sign In'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.studentName}>{student.fullName}</Text>
          <TouchableOpacity onPress={handleLogout}>
            <Text style={styles.subText}>{student.yearGroup} • Tap to Sign Out</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.walletBox}>
          <Text style={styles.walletAmount}>
            Wallet: £{(student.walletPence / 100).toFixed(2)}
          </Text>
          {student.isFsm && (
            <View style={styles.fsmBadge}>
              <Text style={styles.fsmBadgeText}>£2.65 FSM Active</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollArea}>
        {existingOrder ? (
          <View style={styles.confirmedCard}>
            <Text style={styles.confirmedBadge}>
              {existingOrder.status === 'COLLECTED' ? 'COLLECTED' : 'PRE-ORDER CONFIRMED'}
            </Text>
            <Text style={styles.confirmedTitle}>{existingOrder.summary_text}</Text>
            <Text style={styles.confirmedMeta}>
              FSM Covered: £{(existingOrder.fsm_covered_pence / 100).toFixed(2)} | Wallet Charged: £
              {(existingOrder.wallet_charged_pence / 100).toFixed(2)}
            </Text>
            <View style={styles.nfcInstructionBox}>
              <Text style={styles.nfcInstructionText}>
                Tap your physical NFC card on the canteen reader at lunch to collect your meal.
              </Text>
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.sectionHeader}>1. Choose Your Main Meal (£2.65)</Text>
            {mains.map((item) => {
              const selected = selectedMainId === item.id;
              const soldOut = item.stock_remaining <= 0;
              return (
                <TouchableOpacity
                  key={item.id}
                  disabled={soldOut}
                  onPress={() => setSelectedMainId(selected ? null : item.id)}
                  style={[
                    styles.itemCard,
                    selected && styles.itemCardSelected,
                    soldOut && styles.itemCardDisabled,
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{item.dish_name}</Text>
                    <Text style={styles.itemStock}>
                      {soldOut ? 'Sold Out' : `${item.stock_remaining} portions left`}
                    </Text>
                  </View>
                  <Text style={styles.itemPrice}>£2.65</Text>
                </TouchableOpacity>
              );
            })}

            <Text style={[styles.sectionHeader, { marginTop: 24 }]}>
              2. Optional Drink (£1.00)
            </Text>
            {drinks.map((item) => {
              const selected = selectedDrinkId === item.id;
              const soldOut = item.stock_remaining <= 0;
              return (
                <TouchableOpacity
                  key={item.id}
                  disabled={soldOut}
                  onPress={() => setSelectedDrinkId(selected ? null : item.id)}
                  style={[
                    styles.itemCard,
                    selected && styles.itemCardSelected,
                    soldOut && styles.itemCardDisabled,
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{item.dish_name}</Text>
                    <Text style={styles.itemStock}>{soldOut ? 'Sold Out' : 'Available'}</Text>
                  </View>
                  <Text style={styles.itemPrice}>£1.00</Text>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>

      {!existingOrder && (
        <View style={styles.footerBar}>
          <View style={styles.mathRow}>
            <Text style={styles.mathText}>Subtotal: £{(subtotalPence / 100).toFixed(2)}</Text>
            {fsmAppliedPence > 0 && (
              <Text style={styles.fsmSavedText}>
                FSM: -£{(fsmAppliedPence / 100).toFixed(2)}
              </Text>
            )}
            <Text style={styles.totalDueText}>
              Wallet Pay: £{(walletDuePence / 100).toFixed(2)}
            </Text>
          </View>

          <TouchableOpacity
            disabled={(!selectedMainId && !selectedDrinkId) || submitting}
            onPress={handlePlaceOrder}
            style={[
              styles.orderButton,
              !selectedMainId && !selectedDrinkId && styles.orderButtonDisabled,
            ]}
          >
            <Text style={styles.orderButtonText}>
              {submitting ? 'Confirming...' : 'Confirm Lunch Pre-Order'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loginContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    padding: 20,
  },
  loginCard: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 16,
  },
  loginTitle: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginBottom: 6 },
  loginSubtitle: { fontSize: 14, color: '#64748b', marginBottom: 20 },
  inputLabel: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 6 },
  textInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#0f172a',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    backgroundColor: '#0f172a',
  },
  studentName: { color: '#fff', fontSize: 18, fontWeight: '700' },
  subText: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  walletBox: { alignItems: 'flex-end' },
  walletAmount: { color: '#fff', fontSize: 16, fontWeight: '700' },
  fsmBadge: {
    backgroundColor: '#16a34a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 4,
  },
  fsmBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  scrollArea: { padding: 18, paddingBottom: 140 },
  sectionHeader: { fontSize: 17, fontWeight: '700', color: '#0f172a', marginBottom: 10 },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  itemCardSelected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  itemCardDisabled: { opacity: 0.45 },
  itemTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
  itemStock: { fontSize: 12, color: '#64748b', marginTop: 4 },
  itemPrice: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  confirmedCard: {
    backgroundColor: '#15803d',
    padding: 24,
    borderRadius: 16,
    marginTop: 12,
  },
  confirmedBadge: { color: '#bbf7d0', fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  confirmedTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginVertical: 10 },
  confirmedMeta: { color: '#dcfce7', fontSize: 14 },
  nfcInstructionBox: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    padding: 14,
    borderRadius: 10,
    marginTop: 16,
  },
  nfcInstructionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  footerBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  mathRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  mathText: { fontSize: 14, color: '#475569', fontWeight: '600' },
  fsmSavedText: { fontSize: 14, color: '#16a34a', fontWeight: '700' },
  totalDueText: { fontSize: 15, color: '#0f172a', fontWeight: '800' },
  orderButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  orderButtonDisabled: { backgroundColor: '#94a3b8' },
  orderButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
