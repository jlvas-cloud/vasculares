import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Package, MapPin, TrendingUp, Settings, LogOut, Home, Boxes, History, BarChart3, Truck, Download } from 'lucide-react';

export default function Layout({ children }) {
  const { user, company, logout } = useAuth();
  const location = useLocation();

  const navigation = [
    { name: 'Dashboard', href: '/', icon: Home },
    { name: 'Productos', href: '/products', icon: Package },
    { name: 'Locaciones', href: '/locations', icon: MapPin },
    { name: 'Inventario', href: '/inventory', icon: Boxes },
    { name: 'Planificación', href: '/planning', icon: BarChart3 },
    { name: 'Consignaciones', href: '/consignaciones', icon: Truck },
    { name: 'Llegadas SAP', href: '/sap-arrivals', icon: Download },
    { name: 'Recibir', href: '/warehouse-receipt', icon: TrendingUp },
    { name: 'Consignación', href: '/consignment', icon: TrendingUp },
    { name: 'Consumo', href: '/consumption', icon: Settings },
    { name: 'Historial', href: '/transactions', icon: History },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="flex w-64 flex-col bg-white border-r">
        <div className="flex h-16 items-center border-b px-6">
          <h1 className="text-xl font-bold text-primary">Vasculares</h1>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <nav className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.href;

              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="border-t p-4">
          <div className="mb-2 text-sm">
            <div className="font-medium">{user?.firstname} {user?.lastname}</div>
            <div className="text-muted-foreground">{company?.name}</div>
          </div>
          <Button variant="outline" size="sm" onClick={logout} className="w-full">
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar Sesión
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-8">{children}</div>
      </div>
    </div>
  );
}
