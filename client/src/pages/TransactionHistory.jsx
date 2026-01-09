import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { transaccionesApi, productosApi, locacionesApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { History, Package, TrendingUp, Activity, Filter, X, CheckCircle2, XCircle, Cloud, CloudOff } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { formatDate } from '../lib/utils';

const transactionTypes = {
  WAREHOUSE_RECEIPT: { label: 'Recepción', icon: Package, color: 'text-blue-600 bg-blue-50' },
  CONSIGNMENT_OUT: { label: 'Consignación', icon: TrendingUp, color: 'text-purple-600 bg-purple-50' },
  CONSUMPTION: { label: 'Consumo', icon: Activity, color: 'text-green-600 bg-green-50' },
};

export default function TransactionHistory() {
  const [filters, setFilters] = useState({
    type: '',
    productId: '',
    locationId: '',
    startDate: '',
    endDate: '',
    sapSync: '', // 'synced', 'failed', 'pending', or ''
  });

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['transacciones', filters],
    queryFn: () => {
      const params = {};
      if (filters.type) params.type = filters.type;
      if (filters.productId) params.productId = filters.productId;
      if (filters.locationId) params.locationId = filters.locationId;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.sapSync) params.sapSync = filters.sapSync;
      return transaccionesApi.getAll(params).then((res) => res.data);
    },
  });

  const { data: products } = useQuery({
    queryKey: ['productos'],
    queryFn: () => productosApi.getAll({ active: true }).then((res) => res.data),
  });

  const { data: locations } = useQuery({
    queryKey: ['locaciones'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      type: '',
      productId: '',
      locationId: '',
      startDate: '',
      endDate: '',
      sapSync: '',
    });
  };

  // Helper to get SAP sync status display info
  const getSapSyncStatus = (transaction) => {
    const sap = transaction.sapIntegration;
    if (!sap || sap.pushed === undefined) {
      return { status: 'none', label: null, icon: null, color: null };
    }
    if (sap.pushed) {
      return {
        status: 'synced',
        label: `SAP: ${sap.docNum || sap.docEntry}`,
        icon: CheckCircle2,
        color: 'bg-green-100 text-green-700 border-green-200',
      };
    }
    return {
      status: 'failed',
      label: 'SAP: Error',
      icon: XCircle,
      color: 'bg-red-100 text-red-700 border-red-200',
      error: sap.error,
    };
  };

  const hasActiveFilters = Object.values(filters).some((val) => val !== '');

  if (isLoading) return <div>Cargando...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Historial de Transacciones</h1>
        <p className="text-muted-foreground">Registro completo de movimientos de inventario</p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              <CardTitle className="text-lg">Filtros</CardTitle>
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Limpiar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label>Tipo de Transacción</Label>
              <Select value={filters.type || 'all'} onValueChange={(val) => handleFilterChange('type', val === 'all' ? '' : val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="WAREHOUSE_RECEIPT">Recepción</SelectItem>
                  <SelectItem value="CONSIGNMENT_OUT">Consignación</SelectItem>
                  <SelectItem value="CONSUMPTION">Consumo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Producto</Label>
              <Select value={filters.productId || 'all'} onValueChange={(val) => handleFilterChange('productId', val === 'all' ? '' : val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {products?.map((product) => (
                    <SelectItem key={product._id} value={product._id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Locación</Label>
              <Select value={filters.locationId || 'all'} onValueChange={(val) => handleFilterChange('locationId', val === 'all' ? '' : val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {locations?.map((loc) => (
                    <SelectItem key={loc._id} value={loc._id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Fecha Desde</Label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange('startDate', e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label>Fecha Hasta</Label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange('endDate', e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label>Estado SAP</Label>
              <Select value={filters.sapSync || 'all'} onValueChange={(val) => handleFilterChange('sapSync', val === 'all' ? '' : val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="synced">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                      Sincronizado
                    </span>
                  </SelectItem>
                  <SelectItem value="failed">
                    <span className="flex items-center gap-2">
                      <XCircle className="h-3 w-3 text-red-600" />
                      Error SAP
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions List */}
      <Card>
        <CardHeader>
          <CardTitle>Transacciones ({transactions?.length || 0})</CardTitle>
          <CardDescription>Últimas 50 transacciones</CardDescription>
        </CardHeader>
        <CardContent>
          {transactions && transactions.length > 0 ? (
            <div className="space-y-3">
              {transactions.map((transaction) => {
                const typeInfo = transactionTypes[transaction.type];
                const Icon = typeInfo?.icon || History;
                const sapStatus = getSapSyncStatus(transaction);
                const SapIcon = sapStatus.icon;

                return (
                  <div
                    key={transaction._id}
                    className="flex items-start gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className={`p-2 rounded-lg ${typeInfo?.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>

                    <div className="flex-1 space-y-1">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {typeInfo?.label} - {transaction.productId?.name || 'N/A'}
                            {sapStatus.label && (
                              <Badge variant="outline" className={`text-xs ${sapStatus.color}`}>
                                {SapIcon && <SapIcon className="h-3 w-3 mr-1" />}
                                {sapStatus.label}
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Lote: {transaction.lotNumber} | Cantidad: {transaction.quantity}
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground text-right">
                          {formatDate(transaction.transactionDate)}
                        </div>
                      </div>

                      <div className="text-sm text-muted-foreground">
                        {transaction.type === 'WAREHOUSE_RECEIPT' && (
                          <>Recibido en: {transaction.toLocationId?.name || 'N/A'}</>
                        )}
                        {transaction.type === 'CONSIGNMENT_OUT' && (
                          <>
                            De: {transaction.fromLocationId?.name || 'N/A'} → Hacia:{' '}
                            {transaction.toLocationId?.name || 'N/A'}
                          </>
                        )}
                        {transaction.type === 'CONSUMPTION' && (
                          <>
                            Consumido en: {transaction.toLocationId?.name || 'N/A'}
                            {transaction.consumption?.doctorName && ` | Dr. ${transaction.consumption.doctorName}`}
                            {transaction.consumption?.procedureInfo && ` | ${transaction.consumption.procedureInfo}`}
                          </>
                        )}
                      </div>

                      {transaction.notes && (
                        <div className="text-xs text-muted-foreground italic">Notas: {transaction.notes}</div>
                      )}

                      {sapStatus.error && (
                        <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded mt-1">
                          Error SAP: {sapStatus.error}
                        </div>
                      )}

                      <div className="text-xs text-muted-foreground">
                        Por: {transaction.performedBy?.firstname} {transaction.performedBy?.lastname}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">No hay transacciones</p>
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters ? 'Intenta ajustar los filtros' : 'Las transacciones aparecerán aquí'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
