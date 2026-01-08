import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventarioApi, locacionesApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Package, AlertCircle, Calendar } from 'lucide-react';
import { formatDate } from '../lib/utils';

export default function Inventory() {
  const [selectedLocation, setSelectedLocation] = useState('all');

  const { data: locations } = useQuery({
    queryKey: ['locaciones'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  const { data: inventory, isLoading } = useQuery({
    queryKey: ['inventario', selectedLocation],
    queryFn: () => {
      if (selectedLocation === 'all') {
        return inventarioApi.getSummary().then((res) => res.data);
      }
      return inventarioApi.getByLocation(selectedLocation).then((res) => res.data);
    },
  });

  const { data: lots } = useQuery({
    queryKey: ['lotes', selectedLocation],
    queryFn: () => {
      if (selectedLocation === 'all') {
        return inventarioApi.getLotes().then((res) => res.data);
      }
      return inventarioApi.getLotesByLocation(selectedLocation).then((res) => res.data);
    },
  });

  const { data: expiringLots } = useQuery({
    queryKey: ['expiring-lots'],
    queryFn: () => inventarioApi.getExpiringLotes({ days: 90 }).then((res) => res.data),
  });

  if (isLoading) return <div>Cargando...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Inventario</h1>
        <p className="text-muted-foreground">Vista del inventario y lotes</p>
      </div>

      <div className="grid gap-2 max-w-sm">
        <Label>Filtrar por Locación</Label>
        <Select value={selectedLocation} onValueChange={setSelectedLocation}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las Locaciones</SelectItem>
            {locations?.map((loc) => (
              <SelectItem key={loc._id} value={loc._id}>
                {loc.name} ({loc.type === 'WAREHOUSE' ? 'Almacén' : 'Hospital'})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Expiring Soon Alert */}
      {expiringLots && expiringLots.length > 0 && (
        <Card className="border-yellow-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-700">
              <AlertCircle className="h-5 w-5" />
              Productos por Vencer ({expiringLots.length})
            </CardTitle>
            <CardDescription>Vencen en los próximos 90 días</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {expiringLots.slice(0, 5).map((lot) => (
                <div key={lot._id} className="flex items-center justify-between text-sm p-2 rounded bg-yellow-50">
                  <div>
                    <div className="font-medium">{lot.productId?.name}</div>
                    <div className="text-muted-foreground">
                      Lote: {lot.lotNumber} - {lot.currentLocationId?.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{lot.quantityAvailable} unidades</div>
                    <div className="text-xs text-yellow-700">Vence: {formatDate(lot.expiryDate)}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inventory Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Resumen de Inventario</CardTitle>
          <CardDescription>Stock por producto</CardDescription>
        </CardHeader>
        <CardContent>
          {inventory && inventory.length > 0 ? (
            <div className="space-y-2">
              {inventory.map((item) => (
                <div key={item._id} className="flex items-center justify-between p-4 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <Package className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{item.productId?.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {item.locationId?.name}
                        {item.locationId?.type && ` (${item.locationId.type === 'WAREHOUSE' ? 'Almacén' : 'Hospital'})`}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">{item.quantityAvailable || 0}</div>
                    <div className="text-xs text-muted-foreground">
                      Consignados: {item.quantityConsigned || 0} | Consumidos: {item.quantityConsumed || 0}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No hay inventario disponible
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lots Detail */}
      <Card>
        <CardHeader>
          <CardTitle>Detalle de Lotes</CardTitle>
          <CardDescription>Todos los lotes en {selectedLocation === 'all' ? 'el sistema' : 'esta locación'}</CardDescription>
        </CardHeader>
        <CardContent>
          {lots && lots.length > 0 ? (
            <div className="space-y-2">
              {lots.map((lot) => {
                const isExpiring = new Date(lot.expiryDate) <= new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
                const isExpired = new Date(lot.expiryDate) < new Date();

                return (
                  <div
                    key={lot._id}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      isExpired ? 'bg-red-50 border-red-200' : isExpiring ? 'bg-yellow-50 border-yellow-200' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className={`h-5 w-5 ${isExpired ? 'text-red-500' : isExpiring ? 'text-yellow-500' : 'text-muted-foreground'}`} />
                      <div>
                        <div className="font-medium">{lot.productId?.name}</div>
                        <div className="text-sm text-muted-foreground">
                          Lote: {lot.lotNumber} - {lot.currentLocationId?.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Vence: {formatDate(lot.expiryDate)}
                          {isExpired && <span className="ml-2 text-red-600 font-medium">(VENCIDO)</span>}
                          {!isExpired && isExpiring && <span className="ml-2 text-yellow-600 font-medium">(Por vencer)</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">{lot.quantityAvailable || 0}</div>
                      <div className="text-xs text-muted-foreground">
                        Total: {lot.quantityTotal} | Consumidos: {lot.quantityConsumed || 0}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No hay lotes disponibles
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
