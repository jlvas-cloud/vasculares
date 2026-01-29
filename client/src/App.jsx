import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/ui/toast';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Locations from './pages/Locations';
import Consumption from './pages/Consumption';
import Inventory from './pages/Inventory';
import TransactionHistory from './pages/TransactionHistory';
import Planning from './pages/Planning';
import Consignaciones from './pages/Consignaciones';
import GoodsReceipt from './pages/GoodsReceipt';
import GoodsReceiptHistory from './pages/GoodsReceiptHistory';
import ConsumptionHistory from './pages/ConsumptionHistory';
import Reconciliation from './pages/Reconciliation';
import Pedidos from './pages/Pedidos';
import Settings from './pages/Settings';
import UserManagement from './pages/UserManagement';
import Movimientos from './pages/Movimientos';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function PrivateRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center">Cargando...</div>;
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/*"
                element={
                  <PrivateRoute>
                    <Layout>
                      <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/products" element={<Products />} />
                        <Route path="/locations" element={<Locations />} />
                        <Route path="/consumption" element={<Consumption />} />
                        <Route path="/consumption/history" element={<ConsumptionHistory />} />
                        <Route path="/inventory" element={<Inventory />} />
                        <Route path="/transactions" element={<TransactionHistory />} />
                        <Route path="/planning" element={<Planning />} />
                        <Route path="/consignaciones" element={<Consignaciones />} />
                        <Route path="/movimientos" element={<Movimientos />} />
                        <Route path="/goods-receipt" element={<GoodsReceipt />} />
                        <Route path="/goods-receipt-history" element={<GoodsReceiptHistory />} />
                        <Route path="/reconciliation" element={<Reconciliation />} />
                        <Route path="/pedidos" element={<Pedidos />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/users" element={<UserManagement />} />
                      </Routes>
                    </Layout>
                  </PrivateRoute>
                }
              />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
