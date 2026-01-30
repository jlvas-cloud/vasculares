import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp, TrendingDown, Minus, Activity, Loader2 } from 'lucide-react';

const MONTH_LABELS = {
  '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr',
  '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic',
};

function formatMonthLabel(key) {
  const [year, month] = key.split('-');
  return `${MONTH_LABELS[month]} ${year.slice(2)}`;
}

const CENTRO_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
];

export default function DashboardConsumptionCharts() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-consumption'],
    queryFn: () => analyticsApi.getDashboardConsumption().then((res) => res.data),
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando analytics...</span>
        </CardContent>
      </Card>
    );
  }

  const { months, centros, totalByMonth, byCentroByMonth, summary } = data;

  // Build chart data for total
  const totalChartData = months.map((m) => ({
    month: formatMonthLabel(m),
    total: totalByMonth[m] || 0,
  }));

  // Build chart data per centro
  const centroCharts = centros.map((centro, idx) => {
    const centroData = byCentroByMonth[centro._id] || {};
    const chartData = months.map((m) => ({
      month: formatMonthLabel(m),
      cantidad: centroData[m] || 0,
    }));
    const centroTotal = Object.values(centroData).reduce((s, v) => s + v, 0);
    return {
      ...centro,
      chartData,
      total: centroTotal,
      color: CENTRO_COLORS[idx % CENTRO_COLORS.length],
    };
  });

  // Trend icon
  const TrendIcon = summary.trend > 0 ? TrendingUp : summary.trend < 0 ? TrendingDown : Minus;
  const trendColor = summary.trend > 0 ? 'text-green-600' : summary.trend < 0 ? 'text-red-600' : 'text-muted-foreground';

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div>
        <h2 className="text-xl font-semibold">Consumo de Orsiros</h2>
        <p className="text-sm text-muted-foreground">Últimos 12 meses</p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Consumido (12m)</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalLast12Months}</div>
            <p className="text-xs text-muted-foreground">unidades</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Este Mes</CardTitle>
            <Activity className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.currentMonth}</div>
            <p className="text-xs text-muted-foreground">
              vs {summary.previousMonth} mes anterior
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tendencia</CardTitle>
            <TrendIcon className={`h-4 w-4 ${trendColor}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${trendColor}`}>
              {summary.trend > 0 ? '+' : ''}{summary.trend}%
            </div>
            <p className="text-xs text-muted-foreground">vs mes anterior</p>
          </CardContent>
        </Card>
      </div>

      {/* Total Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Consumo Mensual Total</CardTitle>
          <CardDescription>Todos los centros combinados</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={totalChartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value) => [value, 'Unidades']}
                labelStyle={{ fontWeight: 'bold' }}
              />
              <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Per-Centro Charts */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Por Centro</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {centroCharts.map((centro) => (
            <Card key={centro._id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">{centro.name}</CardTitle>
                  <span className="text-sm font-bold text-muted-foreground">{centro.total} uds</span>
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={centro.chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={30} />
                    <Tooltip
                      formatter={(value) => [value, 'Unidades']}
                      labelStyle={{ fontWeight: 'bold' }}
                    />
                    <Bar dataKey="cantidad" fill={centro.color} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
