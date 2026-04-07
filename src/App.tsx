import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  Plus, 
  Search, 
  ArrowUpCircle, 
  ArrowDownCircle, 
  History, 
  Users, 
  LayoutDashboard, 
  ChevronRight, 
  X, 
  LogOut,
  Wallet,
  CreditCard,
  TrendingUp,
  TrendingDown,
  Calendar,
  User as UserIcon,
  Hash,
  BookOpen,
  ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  doc, 
  updateDoc, 
  serverTimestamp,
  Timestamp,
  where,
  getDocFromServer
} from 'firebase/firestore';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { format } from 'date-fns';
import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { db, auth } from './firebase';
import AuthScreen from './AuthScreen';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface Student {
  id: string;
  name: string;
  section: string;
  rollNumber: string;
  accountNumber: string;
  balance: number;
  dailyWithdrawLimit: number;
  createdAt: Timestamp;
}

interface Transaction {
  id: string;
  studentId: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  date: Timestamp;
  remainingBalance: number;
  description?: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

// Session config
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const SESSION_LOGIN_KEY = 'ledger_session_login_at';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authInitializing, setAuthInitializing] = useState(true);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- Session expiry check (3-day max age) --
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        const loginAt = localStorage.getItem(SESSION_LOGIN_KEY);
        if (loginAt) {
          const elapsed = Date.now() - Number(loginAt);
          if (elapsed > SESSION_MAX_AGE_MS) {
            // Session too old — force re-login
            localStorage.removeItem(SESSION_LOGIN_KEY);
            await signOut(auth);
            setUser(null);
            setAuthInitializing(false);
            return;
          }
        } else {
          // First load with an existing Firebase session but no stamp
          // (e.g. migrated user). Stamp it now so the 3-day window starts.
          localStorage.setItem(SESSION_LOGIN_KEY, String(Date.now()));
        }
        setUser(u);
      } else {
        setUser(null);
      }
      setAuthInitializing(false);
    });
    return () => unsub();
  }, []);

  // -- Inactivity auto-logout (15 min) --
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(async () => {
      if (auth.currentUser) {
        localStorage.removeItem(SESSION_LOGIN_KEY);
        await signOut(auth);
      }
    }, INACTIVITY_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    if (!user) return;

    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    // Start the timer immediately
    resetInactivityTimer();

    const handler = () => resetInactivityTimer();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [user, resetInactivityTimer]);
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'students' | 'logs'>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState<'deposit' | 'withdraw' | 'edit' | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [transactionAmount, setTransactionAmount] = useState('');
  const [transactionNote, setTransactionNote] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const handleBackup = () => {
    const backupData = {
      students,
      transactions,
      exportedAt: new Date().toISOString(),
      version: '1.0'
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger_backup_${format(new Date(), 'yyyy-MM-dd_HHmm')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };



  // Data Listeners
  useEffect(() => {
    if (!user) return;

    const studentsQuery = query(collection(db, 'users', user.uid, 'students'), orderBy('createdAt', 'desc'));
    const unsubscribeStudents = onSnapshot(studentsQuery, (snapshot) => {
      const studentData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Student[];
      setStudents(studentData);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/students`));

    const transactionsQuery = query(collection(db, 'users', user.uid, 'transactions'), orderBy('date', 'desc'));
    const unsubscribeTransactions = onSnapshot(transactionsQuery, (snapshot) => {
      const transactionData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Transaction[];
      setTransactions(transactionData);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/transactions`));

    return () => {
      unsubscribeStudents();
      unsubscribeTransactions();
    };
  }, [user]);

  const generateAccountNumber = () => {
    return 'ACC-' + Math.floor(100000 + Math.random() * 900000);
  };

  const addStudent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const limitVal = parseFloat(formData.get('dailyWithdrawLimit') as string);
    const newStudent = {
      name: formData.get('name') as string,
      section: formData.get('section') as string,
      rollNumber: formData.get('rollNumber') as string,
      accountNumber: generateAccountNumber(),
      balance: 0,
      dailyWithdrawLimit: isNaN(limitVal) || limitVal < 0 ? 0 : limitVal,
      createdAt: Timestamp.now(),
    };

    try {
      console.log('Adding student', newStudent, 'user', user);
      if (!user) throw new Error('Not authenticated');
      const res = await addDoc(collection(db, 'users', user.uid, 'students'), newStudent);
      console.log('Student created', res.id);
      setShowAddStudent(false);
      setToastMsg('Student created');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } catch (error) {
      console.error('Add student failed', error);
      handleFirestoreError(error, OperationType.CREATE, 'students');
      setToastMsg('Failed to create student: ' + (error instanceof Error ? error.message : String(error)));
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);
    }
  };

  const handleTransaction = async () => {
    if (!showTransactionModal || !transactionAmount) return;

    const amount = parseFloat(transactionAmount);
    if (isNaN(amount) || amount <= 0) return;

    if (showTransactionModal === 'edit' && editingTransaction) {
      const student = students.find(s => s.id === editingTransaction.studentId);
      if (!student) return;

      // Revert old transaction effect
      let adjustedBalance = showTransactionModal === 'edit' && editingTransaction.type === 'deposit'
        ? student.balance - editingTransaction.amount
        : student.balance + editingTransaction.amount;

      // Apply new transaction effect (keeping same type for simplicity in edit)
      const newBalance = editingTransaction.type === 'deposit'
        ? adjustedBalance + amount
        : adjustedBalance - amount;

      if (newBalance < 0) {
        alert("Insufficient balance after adjustment");
        return;
      }

      try {
        await updateDoc(doc(db, 'users', user!.uid, 'students', student.id), { balance: newBalance });
        await updateDoc(doc(db, 'users', user!.uid, 'transactions', editingTransaction.id), {
          amount: amount,
          description: transactionNote,
          remainingBalance: newBalance // Note: This only affects the edited transaction's record
        });
        setShowTransactionModal(null);
        setEditingTransaction(null);
        setTransactionAmount('');
        setTransactionNote('');
        setToastMsg('Transaction updated');
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'transactions');
      }
      return;
    }

    if (!selectedStudent) return;
    const newBalance = showTransactionModal === 'deposit' 
      ? selectedStudent.balance + amount 
      : selectedStudent.balance - amount;

    if (newBalance < 0) {
      alert("Insufficient balance");
      return;
    }

    // Daily withdrawal limit check
    if (showTransactionModal === 'withdraw' && selectedStudent.dailyWithdrawLimit > 0) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todaysWithdrawals = transactions
        .filter(t => 
          t.studentId === selectedStudent.id &&
          t.type === 'withdraw' &&
          t.date && t.date.toDate() >= todayStart
        )
        .reduce((sum, t) => sum + t.amount, 0);

      if (todaysWithdrawals + amount > selectedStudent.dailyWithdrawLimit) {
        const remaining = Math.max(0, selectedStudent.dailyWithdrawLimit - todaysWithdrawals);
        alert(`Daily withdrawal limit exceeded.\n\nLimit: RS. ${selectedStudent.dailyWithdrawLimit.toLocaleString()}\nWithdrawn today: RS. ${todaysWithdrawals.toLocaleString()}\nRemaining today: RS. ${remaining.toLocaleString()}`);
        return;
      }
    }

    try {
      // Update student balance
      await updateDoc(doc(db, 'users', user!.uid, 'students', selectedStudent.id), {
        balance: newBalance
      });

      // Create transaction log
      await addDoc(collection(db, 'users', user!.uid, 'transactions'), {
        studentId: selectedStudent.id,
        type: showTransactionModal,
        amount: amount,
        date: Timestamp.now(),
        remainingBalance: newBalance,
        description: transactionNote || (showTransactionModal === 'deposit' ? 'Deposit' : 'Withdrawal')
      });

      // Update selected student state to reflect changes in UI immediately
      setSelectedStudent({ ...selectedStudent, balance: newBalance });
      setShowTransactionModal(null);
      setTransactionAmount('');
      setTransactionNote('');
      setToastMsg(showTransactionModal === 'deposit' ? 'Deposit recorded' : 'Withdrawal recorded');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'transactions');
    }
  };

  const filteredStudents = useMemo(() => {
    return students.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.accountNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.rollNumber.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [students, searchQuery]);

  const stats = useMemo(() => {
    const totalBalance = students.reduce((acc, s) => acc + s.balance, 0);
    const totalStudents = students.length;
    const recentTransactions = transactions.slice(0, 5);
    return { totalBalance, totalStudents, recentTransactions };
  }, [students, transactions]);

  if (loading || authInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  if (!user) {
    return <AuthScreen />;
  }

  const handleSignOut = async () => {
    try {
      localStorage.removeItem(SESSION_LOGIN_KEY);
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      await signOut(auth);
    } catch (err) {
      console.error('Sign out failed', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-0 md:pl-64">
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-slate-200 p-6 z-30">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
            <Wallet className="w-6 h-6 text-white" />
          </div>
          <span className="font-bold text-xl text-slate-900">Ledger</span>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarLink 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')}
            icon={<LayoutDashboard className="w-5 h-5" />}
            label="Dashboard"
          />
          <SidebarLink 
            active={activeTab === 'students'} 
            onClick={() => setActiveTab('students')}
            icon={<Users className="w-5 h-5" />}
            label="Students"
          />
          <SidebarLink 
            active={activeTab === 'logs'} 
            onClick={() => setActiveTab('logs')}
            icon={<History className="w-5 h-5" />}
            label="Transactions"
          />
        </nav>

        <div className="pt-6 border-t border-slate-100">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-full border-2 border-slate-100 bg-blue-100 flex items-center justify-center overflow-hidden">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon className="w-5 h-5 text-blue-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{user.displayName || 'User'}</p>
              <p className="text-xs text-slate-500 truncate">{user.email || ''}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all font-medium"
          >
            <LogOut className="w-5 h-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="w-6 h-6 text-blue-600" />
          <span className="font-bold text-lg">Ledger</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center overflow-hidden">
            {user.photoURL ? (
              <img src={user.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <UserIcon className="w-4 h-4 text-blue-600" />
            )}
          </div>
          <button onClick={handleSignOut} className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-6xl mx-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <header>
                <h1 className="text-2xl font-bold text-slate-900">Welcome back, {user.displayName?.split(' ')[0] || 'User'}</h1>
                <p className="text-slate-500">Here's what's happening with student accounts today.</p>
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <StatCard 
                  label="Total Balance" 
                  value={`RS. ${stats.totalBalance.toLocaleString()}`}
                  icon={<CreditCard className="w-6 h-6 text-blue-600" />}
                  color="blue"
                />
                <StatCard 
                  label="Total Students" 
                  value={stats.totalStudents.toString()}
                  icon={<Users className="w-6 h-6 text-purple-600" />}
                  color="purple"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-900">Recent Transactions</h2>
                    <button onClick={() => setActiveTab('logs')} className="text-blue-600 text-sm font-semibold hover:underline">View All</button>
                  </div>
                  <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                    {stats.recentTransactions.length > 0 ? (
                      <div className="divide-y divide-slate-100">
                        {stats.recentTransactions.map(tx => (
                          <div key={tx.id}>
                            <TransactionItem tx={tx} student={students.find(s => s.id === tx.studentId)} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-12 text-center">
                        <History className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                        <p className="text-slate-500">No transaction yet.</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <h2 className="text-lg font-bold text-slate-900">Quick Actions</h2>
                  <div className="grid grid-cols-1 gap-4">
                    <button 
                      onClick={() => { setShowAddStudent(true); setActiveTab('students'); }}
                      className="p-4 bg-white border border-slate-200 rounded-2xl flex items-center gap-4 hover:border-blue-300 hover:bg-blue-50 transition-all group"
                    >
                      <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center group-hover:bg-blue-600 transition-colors">
                        <Plus className="w-6 h-6 text-blue-600 group-hover:text-white" />
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-slate-900">Add Student</p>
                        <p className="text-xs text-slate-500">Create a new account</p>
                      </div>
                    </button>
                    <button 
                      onClick={handleBackup}
                      className="p-4 bg-white border border-slate-200 rounded-2xl flex items-center gap-4 hover:border-emerald-300 hover:bg-emerald-50 transition-all group"
                    >
                      <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center group-hover:bg-emerald-600 transition-colors">
                        <History className="w-6 h-6 text-emerald-600 group-hover:text-white" />
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-slate-900">Backup Data</p>
                        <p className="text-xs text-slate-500">Export all records to JSON</p>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'students' && (
            <motion.div 
              key="students"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h1 className="text-2xl font-bold text-slate-900">Students</h1>
                <button 
                  onClick={() => setShowAddStudent(true)}
                  className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg shadow-blue-100 transition-all"
                >
                  <Plus className="w-5 h-5" />
                  Add New Student
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search by name, roll number or account..." 
                  className="w-full bg-white border border-slate-200 rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none shadow-sm transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredStudents.map(student => (
                  <motion.div 
                    layoutId={student.id}
                    key={student.id} 
                    onClick={() => setSelectedStudent(student)}
                    className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                        <UserIcon className="w-6 h-6 text-slate-600 group-hover:text-blue-600" />
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Balance</p>
                        <p className="text-xl font-black text-slate-900">RS. {student.balance.toLocaleString()}</p>
                      </div>
                    </div>
                    <h3 className="font-bold text-lg text-slate-900 mb-1">{student.name}</h3>
                    <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-xs font-bold uppercase">{student.section}</span>
                      <span>•</span>
                      <span>Roll: {student.rollNumber}</span>
                    </div>
                    <div className="pt-4 border-t border-slate-50 flex items-center justify-between">
                      <span className="text-xs font-mono text-slate-400">{student.accountNumber}</span>
                      <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-500 transition-colors" />
                    </div>
                  </motion.div>
                ))}
              </div>

              {filteredStudents.length === 0 && (
                <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-300">
                  <Users className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                  <p className="text-slate-500 text-lg">No students found.</p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'logs' && (
            <motion.div 
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <h1 className="text-2xl font-bold text-slate-900">Transaction History</h1>
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider">
                        <th className="px-6 py-4">Date</th>
                        <th className="px-6 py-4">Student</th>
                        <th className="px-6 py-4">Type</th>
                        <th className="px-6 py-4">Amount</th>
                        <th className="px-6 py-4">Remaining</th>
                        <th className="px-6 py-4">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.map(tx => {
                        const student = students.find(s => s.id === tx.studentId);
                        return (
                          <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <p className="text-sm font-medium text-slate-900">
                                {tx.date ? format(tx.date.toDate(), 'MMM dd, yyyy') : '...'}
                              </p>
                              <p className="text-xs text-slate-400">
                                {tx.date ? format(tx.date.toDate(), 'hh:mm a') : ''}
                              </p>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm font-bold text-slate-900">{student?.name || 'Unknown'}</p>
                              <p className="text-xs text-slate-400">{student?.accountNumber}</p>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                                tx.type === 'deposit' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                              )}>
                                {tx.type}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <p className={cn(
                                "text-sm font-bold",
                                tx.type === 'deposit' ? "text-emerald-600" : "text-red-600"
                              )}>
                                {tx.type === 'deposit' ? '+' : '-'}RS. {tx.amount.toLocaleString()}
                              </p>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm font-medium text-slate-900">RS. {tx.remainingBalance.toLocaleString()}</p>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm text-slate-500 max-w-xs truncate">{tx.description}</p>
                                <button 
                                  onClick={() => {
                                    setEditingTransaction(tx);
                                    setTransactionAmount(tx.amount.toString());
                                    setTransactionNote(tx.description || '');
                                    setShowTransactionModal('edit');
                                  }}
                                  className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"
                                  title="Edit Transaction"
                                >
                                  <CreditCard className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {transactions.length === 0 && (
                  <div className="p-20 text-center">
                    <History className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                    <p className="text-slate-500">No transaction records found.</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-around z-40">
        <MobileNavLink 
          active={activeTab === 'dashboard'} 
          onClick={() => setActiveTab('dashboard')}
          icon={<LayoutDashboard className="w-6 h-6" />}
          label="Home"
        />
        <MobileNavLink 
          active={activeTab === 'students'} 
          onClick={() => setActiveTab('students')}
          icon={<Users className="w-6 h-6" />}
          label="Students"
        />
        <MobileNavLink 
          active={activeTab === 'logs'} 
          onClick={() => setActiveTab('logs')}
          icon={<History className="w-6 h-6" />}
          label="Logs"
        />
      </nav>

      {/* Modals */}
      <AnimatePresence>
        {showAddStudent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddStudent(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">Add New Student</h2>
                <button onClick={() => setShowAddStudent(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              <form onSubmit={addStudent} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">Full Name</label>
                  <div className="relative">
                    <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input required name="name" type="text" placeholder="John Doe" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-12 pr-4 outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Section</label>
                    <div className="relative">
                      <BookOpen className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input required name="section" type="text" placeholder="10-A" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-12 pr-4 outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Roll Number</label>
                    <div className="relative">
                      <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input required name="rollNumber" type="text" placeholder="12345" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-12 pr-4 outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">Daily Withdraw Limit (RS.)</label>
                  <div className="relative">
                    <ShieldAlert className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input name="dailyWithdrawLimit" type="number" min="0" step="any" placeholder="0 = No limit" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-12 pr-4 outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
                  </div>
                  <p className="text-[10px] text-slate-400 ml-1">Leave empty or 0 for unlimited withdrawals per day.</p>
                </div>
                <button type="submit" className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-lg shadow-blue-100 transition-all mt-4">
                  Create Account
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {selectedStudent && !showTransactionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedStudent(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              layoutId={selectedStudent.id}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="bg-blue-600 p-8 text-white relative shrink-0">
                <button onClick={() => setSelectedStudent(null)} className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-5 h-5 text-white" />
                </button>
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md">
                    <UserIcon className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">{selectedStudent.name}</h2>
                    <p className="text-blue-100 opacity-80">{selectedStudent.accountNumber}</p>
                  </div>
                </div>
                <div className="bg-white/10 rounded-2xl p-4 backdrop-blur-md border border-white/10">
                  <p className="text-xs font-bold text-blue-100 uppercase tracking-widest mb-1">Available Balance</p>
                  <p className="text-4xl font-black">RS. {selectedStudent.balance.toLocaleString()}</p>
                </div>
              </div>
              {/* Scrollable content */}
              <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Section</p>
                    <p className="font-bold text-slate-900">{selectedStudent.section}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Roll Number</p>
                    <p className="font-bold text-slate-900">{selectedStudent.rollNumber}</p>
                  </div>
                </div>

                <DailyLimitEditor
                  student={selectedStudent}
                  transactions={transactions}
                  onUpdate={async (newLimit) => {
                    if (!user) return;
                    await updateDoc(doc(db, 'users', user.uid, 'students', selectedStudent.id), { dailyWithdrawLimit: newLimit });
                    setSelectedStudent({ ...selectedStudent, dailyWithdrawLimit: newLimit });
                  }}
                />

                <div className="flex gap-4">
                  <button 
                    onClick={() => setShowTransactionModal('deposit')}
                    className="flex-1 flex flex-col items-center gap-2 p-4 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-2xl hover:bg-emerald-100 transition-all"
                  >
                    <ArrowUpCircle className="w-8 h-8" />
                    <span className="font-bold">Deposit</span>
                  </button>
                  <button 
                    onClick={() => setShowTransactionModal('withdraw')}
                    className="flex-1 flex flex-col items-center gap-2 p-4 bg-red-50 text-red-700 border border-red-100 rounded-2xl hover:bg-red-100 transition-all"
                  >
                    <ArrowDownCircle className="w-8 h-8" />
                    <span className="font-bold">Withdraw</span>
                  </button>
                </div>

                <div className="space-y-4">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <History className="w-5 h-5 text-slate-400" />
                    Recent Activity
                  </h3>
                  <div className="space-y-3 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                    {transactions
                      .filter(t => t.studentId === selectedStudent.id)
                      .map(tx => (
                        <div key={tx.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center",
                              tx.type === 'deposit' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                            )}>
                              {tx.type === 'deposit' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-900">{tx.description}</p>
                              <p className="text-[10px] text-slate-400">{tx.date ? format(tx.date.toDate(), 'MMM dd') : ''}</p>
                            </div>
                          </div>
                          <p className={cn(
                            "text-sm font-black",
                            tx.type === 'deposit' ? "text-emerald-600" : "text-red-600"
                          )}>
                            {tx.type === 'deposit' ? '+' : '-'}RS. {tx.amount.toLocaleString()}
                          </p>
                        </div>
                      ))}
                    {transactions.filter(t => t.studentId === selectedStudent.id).length === 0 && (
                      <p className="text-center text-slate-400 text-sm py-4">No recent activity</p>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showTransactionModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowTransactionModal(null); setEditingTransaction(null); }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className={cn(
                "p-6 text-white flex items-center justify-between",
                showTransactionModal === 'deposit' ? "bg-emerald-600" : 
                showTransactionModal === 'withdraw' ? "bg-red-600" : "bg-blue-600"
              )}>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  {showTransactionModal === 'deposit' ? <ArrowUpCircle /> : 
                   showTransactionModal === 'withdraw' ? <ArrowDownCircle /> : <CreditCard />}
                  {showTransactionModal === 'deposit' ? 'Deposit Money' : 
                   showTransactionModal === 'withdraw' ? 'Withdraw Money' : 'Edit Transaction'}
                </h2>
                <button onClick={() => { setShowTransactionModal(null); setEditingTransaction(null); }} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">Amount (RS.)</label>
                  <input 
                    autoFocus
                    type="number" 
                    placeholder="0.00" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-6 text-2xl font-black outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    value={transactionAmount}
                    onChange={(e) => setTransactionAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">Note (Optional)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Monthly fee, Library fine" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    value={transactionNote}
                    onChange={(e) => setTransactionNote(e.target.value)}
                  />
                </div>
                <button 
                  onClick={handleTransaction}
                  className={cn(
                    "w-full py-4 text-white font-bold rounded-2xl shadow-lg transition-all mt-4",
                    showTransactionModal === 'deposit' ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100" : 
                    showTransactionModal === 'withdraw' ? "bg-red-600 hover:bg-red-700 shadow-red-100" : "bg-blue-600 hover:bg-blue-700 shadow-blue-100"
                  )}
                >
                  {showTransactionModal === 'edit' ? 'Update Transaction' : `Confirm ${showTransactionModal === 'deposit' ? 'Deposit' : 'Withdrawal'}`}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
        {showToast && (
          <div className="fixed right-6 bottom-6 z-50">
            <div className="bg-emerald-600 text-white px-5 py-3 rounded-lg shadow-lg">{toastMsg}</div>
          </div>
        )}
    </div>
  );
}

// Sub-components
function SidebarLink({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium",
        active ? "bg-blue-50 text-blue-600 shadow-sm shadow-blue-50" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MobileNavLink({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-all",
        active ? "text-blue-600" : "text-slate-400"
      )}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      {active && <motion.div layoutId="activeNav" className="w-1 h-1 bg-blue-600 rounded-full" />}
    </button>
  );
}

function StatCard({ label, value, icon, color }: { label: string, value: string, icon: React.ReactNode, color: 'blue' | 'purple' | 'emerald' }) {
  const colors = {
    blue: "bg-blue-50 border-blue-100",
    purple: "bg-purple-50 border-purple-100",
    emerald: "bg-emerald-50 border-emerald-100"
  };

  return (
    <div className={cn("p-6 rounded-3xl border shadow-sm", colors[color])}>
      <div className="flex items-center justify-between mb-4">
        <div className="p-3 bg-white rounded-xl shadow-sm">{icon}</div>
      </div>
      <p className="text-slate-500 text-sm font-medium mb-1">{label}</p>
      <p className="text-3xl font-black text-slate-900">{value}</p>
    </div>
  );
}

function TransactionItem({ tx, student }: { tx: Transaction, student?: Student }) {
  return (
    <div className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
      <div className="flex items-center gap-4">
        <div className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center",
          tx.type === 'deposit' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
        )}>
          {tx.type === 'deposit' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
        </div>
        <div>
          <p className="font-bold text-slate-900">{student?.name || 'Unknown'}</p>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-mono">{student?.accountNumber}</span>
            <span>•</span>
            <span>{tx.date ? format(tx.date.toDate(), 'MMM dd, hh:mm a') : '...'}</span>
          </div>
        </div>
      </div>
      <div className="text-right">
        <p className={cn(
          "font-black",
          tx.type === 'deposit' ? "text-emerald-600" : "text-red-600"
        )}>
          {tx.type === 'deposit' ? '+' : '-'}RS. {tx.amount.toLocaleString()}
        </p>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Balance: RS. {tx.remainingBalance.toLocaleString()}</p>
      </div>
    </div>
  );
}

function DailyLimitEditor({ student, transactions, onUpdate }: {
  student: Student;
  transactions: Transaction[];
  onUpdate: (newLimit: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [limitValue, setLimitValue] = useState('');
  const [saving, setSaving] = useState(false);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaysWithdrawn = transactions
    .filter(t =>
      t.studentId === student.id &&
      t.type === 'withdraw' &&
      t.date && t.date.toDate() >= todayStart
    )
    .reduce((sum, t) => sum + t.amount, 0);

  const limit = student.dailyWithdrawLimit || 0;
  const remaining = limit > 0 ? Math.max(0, limit - todaysWithdrawn) : null;

  const handleSave = async () => {
    const parsed = parseFloat(limitValue);
    const newLimit = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setSaving(true);
    try {
      await onUpdate(newLimit);
      setEditing(false);
    } catch {
      // handled upstream
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-bold text-amber-600 uppercase flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5" />
          Daily Withdraw Limit
        </p>
        <button
          onClick={() => { setEditing(!editing); setLimitValue(String(limit || '')); }}
          className="text-[10px] font-bold text-amber-700 hover:underline uppercase tracking-wider"
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>
      {!editing ? (
        <div>
          <p className="font-bold text-slate-900 text-lg">
            {limit > 0 ? `RS. ${limit.toLocaleString()}` : 'Unlimited'}
          </p>
          {limit > 0 && (
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Used today</span>
                <span className="font-bold text-slate-700">RS. {todaysWithdrawn.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Remaining today</span>
                <span className="font-bold text-emerald-600">RS. {remaining!.toLocaleString()}</span>
              </div>
              <div className="w-full bg-amber-200 rounded-full h-1.5 mt-1">
                <div
                  className="bg-amber-600 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (todaysWithdrawn / limit) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-1">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0 = No limit"
            value={limitValue}
            onChange={(e) => setLimitValue(e.target.value)}
            className="flex-1 bg-white border border-amber-200 rounded-lg py-2 px-3 text-sm outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-sm font-bold rounded-lg transition-colors"
          >
            {saving ? '...' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
