import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { inventarioApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Package, MapPin, AlertTriangle, TrendingUp } from 'lucide-react';
import DashboardConsumptionCharts from '../components/DashboardConsumptionCharts';

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => inventarioApi.getDashboardStats().then((res) => res.data),
  });

  const { data: alerts } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => inventarioApi.getAlerts().then((res) => res.data),
  });

  if (isLoading) {
    return <div className="p-8">Cargando...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Resumen del inventario de productos vasculares</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Productos</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.products || 0}</div>
            <p className="text-xs text-muted-foreground">En catálogo</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Locaciones</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.locations || 0}</div>
            <p className="text-xs text-muted-foreground">Hospitales y almacenes</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Disponible</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.inventory?.available || 0}</div>
            <p className="text-xs text-muted-foreground">Unidades en stock</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertas</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(stats?.alerts?.lowStock || 0) + (stats?.alerts?.expiringSoon || 0) + (stats?.alerts?.expired || 0)}
            </div>
            <p className="text-xs text-muted-foreground">Stock bajo y vencimientos</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Acciones Rápidas</CardTitle>
          <CardDescription>Operaciones principales del sistema</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Button asChild variant="outline" className="h-24">
            <Link to="/warehouse-receipt">
              <div className="text-center">
                <Package className="mx-auto h-6 w-6 mb-2" />
                <div>Recibir en Almacén</div>
              </div>
            </Link>
          </Button>

          <Button asChild variant="outline" className="h-24">
            <Link to="/consignment">
              <div className="text-center">
                <TrendingUp className="mx-auto h-6 w-6 mb-2" />
                <div>Enviar en Consignación</div>
              </div>
            </Link>
          </Button>

          <Button asChild variant="outline" className="h-24">
            <Link to="/consumption">
              <div className="text-center">
                <MapPin className="mx-auto h-6 w-6 mb-2" />
                <div>Registrar Consumo</div>
              </div>
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Consumption Analytics */}
      <DashboardConsumptionCharts />

      {/* Alerts */}
      {alerts && (alerts.lowStock?.length > 0 || alerts.expiringSoon?.length > 0 || alerts.expired?.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Alertas</CardTitle>
            <CardDescription>Requieren atención</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {alerts.expired?.length > 0 && (
              <div className="rounded-lg border-l-4 border-destructive bg-destructive/10 p-4">
                <h3 className="font-semibold text-destructive">Productos Vencidos ({alerts.expired.length})</h3>
                <p className="text-sm text-muted-foreground">Hay productos vencidos que requieren atención</p>
              </div>
            )}

            {alerts.expiringSoon?.length > 0 && (
              <div className="rounded-lg border-l-4 border-yellow-500 bg-yellow-50 p-4">
                <h3 className="font-semibold text-yellow-700">Por Vencer ({alerts.expiringSoon.length})</h3>
                <p className="text-sm text-muted-foreground">Productos que vencen en los próximos 90 días</p>
              </div>
            )}

            {alerts.lowStock?.length > 0 && (
              <div className="rounded-lg border-l-4 border-orange-500 bg-orange-50 p-4">
                <h3 className="font-semibold text-orange-700">Stock Bajo ({alerts.lowStock.length})</h3>
                <p className="text-sm text-muted-foreground">Productos con stock bajo</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
