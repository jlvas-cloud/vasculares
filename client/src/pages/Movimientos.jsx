import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { analyticsApi, locacionesApi, inventarioObjetivosApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { useToast } from '../components/ui/toast';
import { AlertTriangle, CheckCircle2, Edit, Loader2, TrendingUp } from 'lucide-react';

const MONTH_LABELS = {
  '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr',
  '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic',
};

function formatMonthLabel(key) {
  // key is "YYYY-MM"
  const [year, month] = key.split('-');
  return `${MONTH_LABELS[month]} ${year.slice(2)}`;
}

export default function Movimientos() {
  const [centro, setCentro] = useState('');
  const [category, setCategory] = useState('all');
  const [editingProduct, setEditingProduct] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: locations } = useQuery({
    queryKey: ['locaciones'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  const centros = locations?.filter((loc) => loc.type === 'CENTRO' || loc.type === 'HOSPITAL' || loc.type === 'CLINIC') || [];

  // Auto-select first centro
  const selectedCentro = centro || centros[0]?._id || '';

  const { data: movementData, isLoading, isFetching } = useQuery({
    queryKey: ['monthly-movements', selectedCentro, category],
    queryFn: () => {
      const params = { centroId: selectedCentro };
      if (category && category !== 'all') params.category = category;
      return analyticsApi.getMonthlyMovements(params).then((res) => res.data);
    },
    enabled: !!selectedCentro,
    placeholderData: keepPreviousData,
  });

  const upsertTargetMutation = useMutation({
    mutationFn: (data) => inventarioObjetivosApi.upsert(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['monthly-movements']);
      setEditOpen(false);
      setEditingProduct(null);
      toast.success('Objetivo actualizado');
    },
    onError: (error) => {
      const message = error?.response?.data?.error || error?.message || 'Error al actualizar';
      toast.error(message);
    },
  });

  const handleEdit = (item) => {
    setEditingProduct(item);
    setEditOpen(true);
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const targetStock = parseInt(formData.get('targetStock')) || 0;
    upsertTargetMutation.mutate({
      productId: editingProduct.productId,
      locationId: selectedCentro,
      targetStock,
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'warning': return 'bg-yellow-100 text-yellow-800';
      case 'ok': return 'bg-green-100 text-green-800';
      case 'sin_configurar': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'critical': return 'Crítico';
      case 'warning': return 'Alerta';
      case 'ok': return 'OK';
      case 'sin_configurar': return 'Sin Config';
      default: return status;
    }
  };

  const months = movementData?.months || [];
  const items = movementData?.items || [];

  // Filter to only show products with activity or stock or target
  const activeItems = items.filter((item) => item.total > 0 || item.currentStock > 0 || item.targetStock > 0);

  // Summary stats
  const totalConsumed = activeItems.reduce((sum, item) => sum + item.total, 0);
  const productsWithActivity = activeItems.filter((item) => item.total > 0).length;
  const criticalCount = activeItems.filter((item) => item.status === 'critical').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Movimientos por Centro</h1>
        <p className="text-muted-foreground">
          Consumo mensual por producto en los últimos 12 meses
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Consumido (12m)</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalConsumed}</div>
            <p className="text-xs text-muted-foreground">unidades</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Productos con Movimiento</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{productsWithActivity}</div>
            <p className="text-xs text-muted-foreground">de {activeItems.length} con stock/objetivo</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Nivel Crítico</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{criticalCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label>Centro</Label>
              <Select value={selectedCentro} onValueChange={setCentro}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar centro" />
                </SelectTrigger>
                <SelectContent>
                  {centros.map((loc) => (
                    <SelectItem key={loc._id} value={loc._id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Categoría</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="GUIAS">Guías</SelectItem>
                  <SelectItem value="STENTS_CORONARIOS">Stents Coronarios</SelectItem>
                  <SelectItem value="STENTS_RECUBIERTOS">Stents Recubiertos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Movements Table */}
      <Card className={isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Consumo Mensual ({activeItems.length} productos)</CardTitle>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <CardDescription>
            Unidades consumidas por mes en {centros.find((c) => c._id === selectedCentro)?.name || 'centro seleccionado'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 font-medium sticky left-0 bg-muted/50 z-10 min-w-[180px]">Producto</th>
                  <th className="text-left p-2 font-medium min-w-[70px]">Tam.</th>
                  {months.map((m) => (
                    <th key={m} className="text-center p-2 font-medium min-w-[50px]">
                      {formatMonthLabel(m)}
                    </th>
                  ))}
                  <th className="text-center p-2 font-medium bg-muted min-w-[50px]">Total</th>
                  <th className="text-center p-2 font-medium bg-muted min-w-[50px]">Prom</th>
                  <th className="text-center p-2 font-medium min-w-[50px]">Stock</th>
                  <th className="text-center p-2 font-medium min-w-[60px]">Objetivo</th>
                  <th className="text-center p-2 font-medium min-w-[70px]">Estado</th>
                  <th className="text-center p-2 font-medium min-w-[50px]"></th>
                </tr>
              </thead>
              <tbody>
                {activeItems.length > 0 ? (
                  activeItems.map((item) => (
                    <tr key={item.productId} className="border-b hover:bg-muted/50">
                      <td className="p-2 sticky left-0 bg-white z-10">
                        <div>
                          <div className="font-medium text-xs">{item.productName}</div>
                          <div className="text-xs text-muted-foreground">{item.sapItemCode}</div>
                        </div>
                      </td>
                      <td className="p-2 text-xs">{item.size}</td>
                      {months.map((m) => {
                        const qty = item.monthlyData[m] || 0;
                        return (
                          <td key={m} className="p-2 text-center text-xs">
                            {qty > 0 ? (
                              <span className="font-medium">{qty}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-2 text-center text-xs font-bold bg-muted/30">
                        {item.total > 0 ? item.total : '-'}
                      </td>
                      <td className="p-2 text-center text-xs font-medium bg-muted/30">
                        {item.average > 0 ? item.average.toFixed(1) : '-'}
                      </td>
                      <td className="p-2 text-center text-xs">
                        <span className={`font-medium ${
                          item.status === 'critical' ? 'text-red-600' :
                          item.status === 'warning' ? 'text-yellow-600' :
                          item.status === 'ok' ? 'text-green-600' :
                          'text-blue-600'
                        }`}>
                          {item.currentStock}
                        </span>
                      </td>
                      <td className="p-2 text-center text-xs font-medium">
                        {item.targetStock || '-'}
                      </td>
                      <td className="p-2 text-center">
                        <Badge className={`text-xs ${getStatusColor(item.status)}`}>
                          {getStatusLabel(item.status)}
                        </Badge>
                      </td>
                      <td className="p-2 text-center">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(item)}>
                          <Edit className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={months.length + 8} className="text-center py-8 text-muted-foreground">
                      {selectedCentro ? 'No hay datos de movimiento para este centro' : 'Selecciona un centro'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Target Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Stock Objetivo</DialogTitle>
          </DialogHeader>
          {editingProduct && (
            <form onSubmit={handleSaveEdit}>
              <div className="space-y-4 py-4">
                <div>
                  <p className="font-medium">{editingProduct.productName}</p>
                  <p className="text-sm text-muted-foreground">
                    {editingProduct.sapItemCode} - {editingProduct.size}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Stock actual:</span>
                    <span className="ml-2 font-medium">{editingProduct.currentStock}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Promedio mensual:</span>
                    <span className="ml-2 font-medium">{editingProduct.average?.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total 12 meses:</span>
                    <span className="ml-2 font-medium">{editingProduct.total}</span>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="targetStock">Stock Objetivo</Label>
                  <Input
                    id="targetStock"
                    name="targetStock"
                    type="number"
                    min="0"
                    defaultValue={editingProduct.targetStock || 0}
                    className="w-full"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={upsertTargetMutation.isPending}>
                  {upsertTargetMutation.isPending ? 'Guardando...' : 'Guardar'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
