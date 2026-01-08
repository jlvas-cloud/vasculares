import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { productosApi, locacionesApi, inventarioApi, transaccionesApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { TrendingUp } from 'lucide-react';
import { formatDate } from '../lib/utils';
import { useToast } from '../components/ui/toast';

export default function Consignment() {
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedFromLocation, setSelectedFromLocation] = useState('');
  const [selectedToLocation, setSelectedToLocation] = useState('');
  const [selectedLot, setSelectedLot] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const { data: products } = useQuery({
    queryKey: ['productos'],
    queryFn: () => productosApi.getAll({ active: true }).then((res) => res.data),
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => locacionesApi.getAll({ type: 'WAREHOUSE', active: true }).then((res) => res.data),
  });

  const { data: allHospitals } = useQuery({
    queryKey: ['hospitals-clinics'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  const hospitals = allHospitals?.filter((loc) => loc.type === 'HOSPITAL' || loc.type === 'CLINIC') || [];

  const { data: lots } = useQuery({
    queryKey: ['lotes-available', selectedProduct, selectedFromLocation],
    queryFn: () =>
      inventarioApi.getLotesByLocation(selectedFromLocation, { productId: selectedProduct }).then((res) => res.data),
    enabled: !!selectedProduct && !!selectedFromLocation,
  });

  const createMutation = useMutation({
    mutationFn: transaccionesApi.consignmentOut,
    onSuccess: () => {
      queryClient.invalidateQueries(['inventario']);
      queryClient.invalidateQueries(['lotes']);
      queryClient.invalidateQueries(['dashboard-stats']);
      toast.success('Productos enviados en consignación exitosamente');
      navigate('/inventory');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al enviar en consignación');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      productId: selectedProduct,
      lotId: selectedLot,
      fromLocationId: selectedFromLocation,
      toLocationId: selectedToLocation,
      quantity: parseInt(formData.get('quantity')),
      notes: formData.get('notes'),
    };
    createMutation.mutate(data);
  };

  const availableLots = lots?.filter((lot) => lot.quantityAvailable > 0) || [];
  const selectedLotData = availableLots.find((lot) => lot._id === selectedLot);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Enviar en Consignación</h1>
        <p className="text-muted-foreground">Enviar productos del almacén al hospital o clínica</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nueva Consignación</CardTitle>
          <CardDescription>Seleccione los productos a enviar</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Desde (Almacén)</Label>
                <Select value={selectedFromLocation} onValueChange={setSelectedFromLocation} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses?.map((loc) => (
                      <SelectItem key={loc._id} value={loc._id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>Hacia (Hospital/Clínica)</Label>
                <Select value={selectedToLocation} onValueChange={setSelectedToLocation} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {hospitals?.map((loc) => (
                      <SelectItem key={loc._id} value={loc._id}>
                        {loc.name} ({loc.type === 'HOSPITAL' ? 'Hospital' : 'Clínica'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Producto</Label>
              <Select value={selectedProduct} onValueChange={setSelectedProduct} required>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar producto" />
                </SelectTrigger>
                <SelectContent>
                  {products?.map((product) => (
                    <SelectItem key={product._id} value={product._id}>
                      {product.name} (Código: {product.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {availableLots.length > 0 && (
              <div className="grid gap-2">
                <Label>Lote Disponible</Label>
                <Select value={selectedLot} onValueChange={setSelectedLot} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar lote" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableLots.map((lot) => (
                      <SelectItem key={lot._id} value={lot._id}>
                        {lot.lotNumber} - Disponible: {lot.quantityAvailable} - Vence: {formatDate(lot.expiryDate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedLotData && (
              <div className="rounded-lg bg-muted p-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-muted-foreground">Lote:</span> {selectedLotData.lotNumber}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Disponible:</span> {selectedLotData.quantityAvailable}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Vencimiento:</span> {formatDate(selectedLotData.expiryDate)}
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="quantity">Cantidad a Enviar</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min="1"
                max={selectedLotData?.quantityAvailable || 0}
                placeholder="10"
                required
              />
              {selectedLotData && (
                <p className="text-xs text-muted-foreground">Máximo: {selectedLotData.quantityAvailable} unidades</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notas (Opcional)</Label>
              <Input id="notes" name="notes" placeholder="Información adicional" />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={createMutation.isPending || !selectedLot} className="flex-1">
                <TrendingUp className="mr-2 h-4 w-4" />
                {createMutation.isPending ? 'Enviando...' : 'Enviar en Consignación'}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
