import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { BarChart3, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function Planning() {
  const [category, setCategory] = useState('all');

  const { data: planningData, isLoading } = useQuery({
    queryKey: ['planning-data', category],
    queryFn: () => {
      const params = {};
      if (category && category !== 'all') params.category = category;
      return analyticsApi.getPlanningData(params).then((res) => res.data);
    },
  });

  const getStatusColor = (status) => {
    switch (status) {
      case 'critical':
        return 'bg-red-100 text-red-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800';
      case 'ok':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'critical':
        return <AlertTriangle className="h-4 w-4" />;
      case 'warning':
        return <TrendingUp className="h-4 w-4" />;
      case 'ok':
        return <CheckCircle2 className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'critical':
        return 'Crítico';
      case 'warning':
        return 'Advertencia';
      case 'ok':
        return 'OK';
      default:
        return 'N/A';
    }
  };

  // Calculate summary stats
  const stats = planningData
    ? {
        total: planningData.length,
        critical: planningData.filter((p) => p.status === 'critical').length,
        warning: planningData.filter((p) => p.status === 'warning').length,
        totalSuggestedOrder: planningData.reduce((sum, p) => sum + p.suggestedOrder, 0),
      }
    : { total: 0, critical: 0, warning: 0, totalSuggestedOrder: 0 };

  if (isLoading) return <div>Cargando...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Planificación de Inventario</h1>
        <p className="text-muted-foreground">Vista tipo Excel para gestión de stock y reposiciones</p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Productos</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Nivel Crítico</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.critical}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Advertencias</CardTitle>
            <TrendingUp className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats.warning}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total a Ordenar</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSuggestedOrder}</div>
            <p className="text-xs text-muted-foreground">unidades sugeridas</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Filtros</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
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
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Planning Table */}
      <Card>
        <CardHeader>
          <CardTitle>Productos ({planningData?.length || 0})</CardTitle>
          <CardDescription>
            Vista consolidada de inventario y sugerencias de reposición
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 font-medium">Producto</th>
                  <th className="text-left p-2 font-medium">Tamaño</th>
                  <th className="text-right p-2 font-medium">Stock Almacén</th>
                  <th className="text-right p-2 font-medium">En Consignación</th>
                  <th className="text-right p-2 font-medium">Consumo Mensual Prom.</th>
                  <th className="text-right p-2 font-medium">Días Cobertura</th>
                  <th className="text-right p-2 font-medium">Stock Objetivo</th>
                  <th className="text-right p-2 font-medium">Punto Reorden</th>
                  <th className="text-right p-2 font-medium">Sugerido Ordenar</th>
                  <th className="text-center p-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {planningData && planningData.length > 0 ? (
                  planningData.map((product) => (
                    <tr key={product.productId} className="border-b hover:bg-muted/50">
                      <td className="p-2">
                        <div>
                          <div className="font-medium">{product.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Código: {product.code}
                          </div>
                        </div>
                      </td>
                      <td className="p-2">{product.size}</td>
                      <td className="p-2 text-right">
                        <span
                          className={`font-medium ${
                            product.warehouseStock < product.minStock
                              ? 'text-red-600'
                              : product.warehouseStock <= product.reorderPoint
                              ? 'text-yellow-600'
                              : 'text-green-600'
                          }`}
                        >
                          {product.warehouseStock}
                        </span>
                      </td>
                      <td className="p-2 text-right text-muted-foreground">
                        {product.consignedStock}
                      </td>
                      <td className="p-2 text-right">
                        {product.avgMonthlyConsumption > 0
                          ? product.avgMonthlyConsumption.toFixed(1)
                          : '-'}
                      </td>
                      <td className="p-2 text-right">
                        {product.daysOfCoverage < 999 ? (
                          <span
                            className={
                              product.daysOfCoverage < 15
                                ? 'text-red-600 font-medium'
                                : product.daysOfCoverage < 30
                                ? 'text-yellow-600 font-medium'
                                : 'text-green-600'
                            }
                          >
                            {product.daysOfCoverage}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="p-2 text-right text-muted-foreground">
                        {product.targetStock || '-'}
                      </td>
                      <td className="p-2 text-right text-muted-foreground">
                        {product.reorderPoint || '-'}
                      </td>
                      <td className="p-2 text-right">
                        {product.suggestedOrder > 0 ? (
                          <span className="font-medium text-blue-600">
                            {product.suggestedOrder}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="p-2 text-center">
                        <Badge
                          variant="outline"
                          className={`${getStatusColor(product.status)} border-0`}
                        >
                          <div className="flex items-center gap-1">
                            {getStatusIcon(product.status)}
                            <span>{getStatusLabel(product.status)}</span>
                          </div>
                        </Badge>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="10" className="p-8 text-center text-muted-foreground">
                      No hay productos disponibles
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
