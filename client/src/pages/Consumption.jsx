import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { productosApi, locacionesApi, inventarioApi, transaccionesApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Activity } from 'lucide-react';
import { formatDate } from '../lib/utils';
import { useToast } from '../components/ui/toast';

export default function Consumption() {
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedLot, setSelectedLot] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const { data: products } = useQuery({
    queryKey: ['productos'],
    queryFn: () => productosApi.getAll({ active: true }).then((res) => res.data),
  });

  const { data: allHospitals } = useQuery({
    queryKey: ['hospitals-clinics'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  const hospitals = allHospitals?.filter((loc) => loc.type === 'HOSPITAL' || loc.type === 'CLINIC') || [];

  const { data: lots } = useQuery({
    queryKey: ['lotes-consumption', selectedProduct, selectedLocation],
    queryFn: () =>
      inventarioApi.getLotesByLocation(selectedLocation, { productId: selectedProduct }).then((res) => res.data),
    enabled: !!selectedProduct && !!selectedLocation,
  });

  const createMutation = useMutation({
    mutationFn: transaccionesApi.consumption,
    onSuccess: () => {
      queryClient.invalidateQueries(['inventario']);
      queryClient.invalidateQueries(['lotes']);
      queryClient.invalidateQueries(['dashboard-stats']);
      toast.success('Consumo registrado exitosamente');
      navigate('/inventory');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al registrar consumo');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      productId: selectedProduct,
      lotId: selectedLot,
      locationId: selectedLocation,
      quantity: parseInt(formData.get('quantity')),
      doctorName: formData.get('doctorName'),
      procedureInfo: formData.get('procedureInfo'),
      patientInfo: formData.get('patientInfo'),
      notes: formData.get('notes'),
    };
    createMutation.mutate(data);
  };

  const availableLots = lots?.filter((lot) => lot.quantityAvailable > 0) || [];
  const selectedLotData = availableLots.find((lot) => lot._id === selectedLot);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Registrar Consumo</h1>
        <p className="text-muted-foreground">Registrar productos utilizados en el hospital o clínica</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nuevo Consumo</CardTitle>
          <CardDescription>Complete la información del consumo</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label>Hospital/Clínica</Label>
              <Select value={selectedLocation} onValueChange={setSelectedLocation} required>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar hospital o clínica" />
                </SelectTrigger>
                <SelectContent>
                  {hospitals?.map((loc) => (
                    <SelectItem key={loc._id} value={loc._id}>
                      {loc.name} ({loc.type === 'HOSPITAL' ? 'Hospital' : 'Clínica'}) - {loc.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <Label>Lote en esta Locación</Label>
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

            {availableLots.length === 0 && selectedLocation && selectedProduct && (
              <div className="rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800">
                No hay lotes disponibles de este producto en esta locación
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
              <Label htmlFor="quantity">Cantidad Consumida</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min="1"
                max={selectedLotData?.quantityAvailable || 0}
                placeholder="2"
                required
              />
              {selectedLotData && (
                <p className="text-xs text-muted-foreground">Máximo: {selectedLotData.quantityAvailable} unidades</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="doctorName">Doctor (Opcional)</Label>
              <Input id="doctorName" name="doctorName" placeholder="Dr. Rodriguez" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="procedureInfo">Procedimiento (Opcional)</Label>
              <Input id="procedureInfo" name="procedureInfo" placeholder="PCI procedure" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="patientInfo">Información del Paciente (Opcional)</Label>
              <Input id="patientInfo" name="patientInfo" placeholder="Opcional" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notas (Opcional)</Label>
              <Input id="notes" name="notes" placeholder="Información adicional" />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={createMutation.isPending || !selectedLot} className="flex-1">
                <Activity className="mr-2 h-4 w-4" />
                {createMutation.isPending ? 'Registrando...' : 'Registrar Consumo'}
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
