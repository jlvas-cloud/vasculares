import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { goodsReceiptApi, locacionesApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Package, Filter, X, CheckCircle2, XCircle, RefreshCw, ChevronDown, ChevronUp, FileBox } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { formatDate } from '../lib/utils';
import { useToast } from '../components/ui/toast';

export default function GoodsReceiptHistory() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filters, setFilters] = useState({
    sapStatus: '',
    locationId: '',
    startDate: '',
    endDate: '',
  });
  const [expandedReceipt, setExpandedReceipt] = useState(null);

  const { data: receipts, isLoading } = useQuery({
    queryKey: ['goods-receipts', filters],
    queryFn: () => {
      const params = {};
      if (filters.sapStatus) params.sapStatus = filters.sapStatus;
      if (filters.locationId) params.locationId = filters.locationId;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      return goodsReceiptApi.getHistory(params).then((res) => res.data);
    },
  });

  const { data: locations } = useQuery({
    queryKey: ['locaciones'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  const retryMutation = useMutation({
    mutationFn: (receiptId) => goodsReceiptApi.retrySap(receiptId),
    onSuccess: (response) => {
      queryClient.invalidateQueries(['goods-receipts']);
      if (response.data.sapIntegration?.pushed) {
        toast.success(`Sincronizado con SAP - Doc #${response.data.sapIntegration.docNum}`);
      } else {
        toast.error(`Error SAP: ${response.data.sapIntegration?.error}`);
      }
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al reintentar sincronización');
    },
  });

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      sapStatus: '',
      locationId: '',
      startDate: '',
      endDate: '',
    });
  };

  const getSapSyncStatus = (receipt) => {
    const sap = receipt.sapIntegration;
    if (!sap) {
      return { status: 'none', label: 'Sin SAP', icon: null, color: 'bg-gray-100 text-gray-600' };
    }
    if (sap.pushed) {
      return {
        status: 'synced',
        label: `SAP Doc #${sap.docNum || sap.docEntry}`,
        icon: CheckCircle2,
        color: 'bg-green-100 text-green-700 border-green-200',
      };
    }
    return {
      status: 'failed',
      label: 'Error SAP',
      icon: XCircle,
      color: 'bg-red-100 text-red-700 border-red-200',
      error: sap.error,
    };
  };

  const toggleExpand = (receiptId) => {
    setExpandedReceipt(expandedReceipt === receiptId ? null : receiptId);
  };

  const hasActiveFilters = Object.values(filters).some((val) => val !== '');

  if (isLoading) return <div>Cargando...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Historial de Entradas</h1>
        <p className="text-muted-foreground">Entradas de Mercancía registradas desde la app</p>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="grid gap-2">
              <Label>Estado SAP</Label>
              <Select value={filters.sapStatus || 'all'} onValueChange={(val) => handleFilterChange('sapStatus', val === 'all' ? '' : val)}>
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

            <div className="grid gap-2">
              <Label>Almacén</Label>
              <Select value={filters.locationId || 'all'} onValueChange={(val) => handleFilterChange('locationId', val === 'all' ? '' : val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {locations?.filter(loc => loc.type === 'WAREHOUSE').map((loc) => (
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
          </div>
        </CardContent>
      </Card>

      {/* Receipts List */}
      <Card>
        <CardHeader>
          <CardTitle>Entradas de Mercancía ({receipts?.length || 0})</CardTitle>
          <CardDescription>Últimas 50 entradas registradas</CardDescription>
        </CardHeader>
        <CardContent>
          {receipts && receipts.length > 0 ? (
            <div className="space-y-3">
              {receipts.map((receipt) => {
                const sapStatus = getSapSyncStatus(receipt);
                const SapIcon = sapStatus.icon;
                const isExpanded = expandedReceipt === receipt._id;

                return (
                  <div
                    key={receipt._id}
                    className="rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    {/* Header row */}
                    <div
                      className="flex items-start gap-4 p-4 cursor-pointer"
                      onClick={() => toggleExpand(receipt._id)}
                    >
                      <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                        <Package className="h-5 w-5" />
                      </div>

                      <div className="flex-1 space-y-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {receipt.locationName || 'Sin ubicación'}
                              <Badge variant="outline" className={`text-xs ${sapStatus.color}`}>
                                {SapIcon && <SapIcon className="h-3 w-3 mr-1" />}
                                {sapStatus.label}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {receipt.items?.length || 0} líneas | Proveedor: {receipt.supplier || 'N/A'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-sm text-muted-foreground text-right">
                              {formatDate(receipt.receiptDate)}
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </div>

                        {sapStatus.error && (
                          <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded mt-1">
                            Error: {sapStatus.error}
                          </div>
                        )}

                        <div className="text-xs text-muted-foreground">
                          Por: {receipt.createdBy?.firstname} {receipt.createdBy?.lastname}
                        </div>
                      </div>

                      {/* Retry button for failed receipts */}
                      {sapStatus.status === 'failed' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            retryMutation.mutate(receipt._id);
                          }}
                          disabled={retryMutation.isPending}
                          className="shrink-0"
                        >
                          <RefreshCw className={`h-4 w-4 mr-1 ${retryMutation.isPending ? 'animate-spin' : ''}`} />
                          Reintentar
                        </Button>
                      )}
                    </div>

                    {/* Expanded items */}
                    {isExpanded && (
                      <div className="border-t px-4 pb-4">
                        <div className="mt-3">
                          <h4 className="text-sm font-medium mb-2">Líneas del documento</h4>
                          <div className="space-y-2">
                            {receipt.items?.map((item, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded"
                              >
                                <div>
                                  <span className="font-medium">{item.productName || item.sapItemCode}</span>
                                  <span className="text-muted-foreground ml-2">
                                    Lote: {item.lotNumber}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="font-medium">{item.quantity} uds</span>
                                  <span className="text-muted-foreground ml-2">
                                    Vence: {formatDate(item.expiryDate)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        {receipt.notes && (
                          <div className="mt-3 text-sm text-muted-foreground">
                            <span className="font-medium">Notas:</span> {receipt.notes}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <FileBox className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">No hay entradas</p>
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters ? 'Intenta ajustar los filtros' : 'Las entradas de mercancía aparecerán aquí'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
