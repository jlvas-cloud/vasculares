import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { productosApi, locacionesApi, transaccionesApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Package } from 'lucide-react';
import { useToast } from '../components/ui/toast';

export default function WarehouseReceipt() {
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const { data: products } = useQuery({
    queryKey: ['productos'],
    queryFn: () => productosApi.getAll({ active: true }).then((res) => res.data),
  });

  const { data: locations } = useQuery({
    queryKey: ['locaciones'],
    queryFn: () => locacionesApi.getAll({ type: 'WAREHOUSE', active: true }).then((res) => res.data),
  });

  const createMutation = useMutation({
    mutationFn: transaccionesApi.warehouseReceipt,
    onSuccess: () => {
      queryClient.invalidateQueries(['inventario']);
      queryClient.invalidateQueries(['lotes']);
      queryClient.invalidateQueries(['dashboard-stats']);
      toast.success('Productos recibidos exitosamente');
      navigate('/inventory');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al recibir productos');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      productId: selectedProduct,
      locationId: selectedLocation,
      lotNumber: formData.get('lotNumber'),
      quantity: parseInt(formData.get('quantity')),
      expiryDate: formData.get('expiryDate'),
      supplier: formData.get('supplier'),
      notes: formData.get('notes'),
    };
    createMutation.mutate(data);
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Recibir en Almacén</h1>
        <p className="text-muted-foreground">Registrar productos recibidos del proveedor</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nueva Recepción</CardTitle>
          <CardDescription>Complete la información de los productos recibidos</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="locationId">Almacén *</Label>
              <Select value={selectedLocation} onValueChange={setSelectedLocation} required>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar almacén" />
                </SelectTrigger>
                <SelectContent>
                  {locations?.map((loc) => (
                    <SelectItem key={loc._id} value={loc._id}>
                      {loc.name} - {loc.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="productId">Producto *</Label>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="lotNumber">Número de Lote *</Label>
                <Input id="lotNumber" name="lotNumber" placeholder="BATCH-2024-001" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="quantity">Cantidad *</Label>
                <Input id="quantity" name="quantity" type="number" min="1" placeholder="50" required />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="expiryDate">Fecha de Vencimiento *</Label>
              <Input
                id="expiryDate"
                name="expiryDate"
                type="date"
                min={new Date().toISOString().split('T')[0]}
                required
              />
              <p className="text-xs text-muted-foreground">Debe ser una fecha futura</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="supplier">Proveedor</Label>
              <Input id="supplier" name="supplier" placeholder="Boston Scientific" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notas (Opcional)</Label>
              <Input id="notes" name="notes" placeholder="Información adicional" />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={createMutation.isPending} className="flex-1">
                <Package className="mr-2 h-4 w-4" />
                {createMutation.isPending ? 'Registrando...' : 'Recibir Productos'}
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
