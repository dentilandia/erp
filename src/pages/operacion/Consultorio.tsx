import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { CheckCircle2, X, Search, Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtCOP, today } from "../../lib/format";
import { TIPOS_INSUMO_CONSULTA, TIPOS_SERVICIO_LAB, type Sede, type Laboratorio, type Doctora } from "../../lib/types";

interface VisitaRow {
  id: string;
  doctora_id: string;
  pacientes: { nombre: string };
  doctoras: { nombre: string; color_pastel: string };
}

interface VisitaPorCobrar extends VisitaRow {
  tratamiento: string | null;
}

interface LabPendienteInstalar {
  id: string;
  paciente_id: string;
  doctora_id: string;
  pacientes: { nombre: string };
  laboratorios: { nombre: string };
  doctoras: { nombre: string; color_pastel: string };
  tipo_servicio: string;
}

interface EnvioLab {
  laboratorioId: string;
  laboratorioNombre: string;
  tipoServicio: string;
  doctoraId: string;
  doctoraNombre: string;
}

export function Consultorio() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [fecha, setFecha] = useState(today());
  const [enEsperaTodas, setEnEsperaTodas] = useState<VisitaRow[]>([]);
  const [atendiendoId, setAtendiendoId] = useState<string | null>(null);
  const [porCobrarTodas, setPorCobrarTodas] = useState<VisitaPorCobrar[]>([]);
  const [editandoValorId, setEditandoValorId] = useState<string | null>(null);
  const [buscarInstalar, setBuscarInstalar] = useState("");
  const [pendientesInstalar, setPendientesInstalar] = useState<LabPendienteInstalar[]>([]);
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [filtroDoctora, setFiltroDoctora] = useState("");
  const [doctoraInstalaPorOrden, setDoctoraInstalaPorOrden] = useState<Record<string, string>>({});
  const [fechaInstaladoPorOrden, setFechaInstaladoPorOrden] = useState<Record<string, string>>({});

  const [mostrarReporteDoctora, setMostrarReporteDoctora] = useState(false);
  const [doctoraReporteId, setDoctoraReporteId] = useState("");
  const [reporteDesde, setReporteDesde] = useState(() => today().slice(0, 8) + "01");
  const [reporteHasta, setReporteHasta] = useState(today());
  const [filasReporte, setFilasReporte] = useState<{ fecha: string; total: number }[]>([]);
  const [cargandoReporte, setCargandoReporte] = useState(false);

  useEffect(() => {
    supabase.from("doctoras").select("*").order("nombre").then(({ data }) => setDoctoras((data as Doctora[]) ?? []));
  }, []);

  useEffect(() => {
    if (!mostrarReporteDoctora || !doctoraReporteId) {
      setFilasReporte([]);
      return;
    }
    (async () => {
      setCargandoReporte(true);
      const { data } = await supabase
        .from("cargo_pagos")
        .select("valor, cargos!inner(categoria, doctora_id, sede_id, fecha)")
        .eq("cargos.sede_id", sedeActiva.id)
        .eq("cargos.doctora_id", doctoraReporteId)
        .eq("cargos.categoria", "procedimiento")
        .gte("cargos.fecha", reporteDesde)
        .lte("cargos.fecha", reporteHasta);
      const filas = (data as unknown as { valor: number; cargos: { fecha: string } }[]) ?? [];
      const porFecha: Record<string, number> = {};
      for (const f of filas) porFecha[f.cargos.fecha] = (porFecha[f.cargos.fecha] ?? 0) + Number(f.valor);
      setFilasReporte(
        Object.entries(porFecha)
          .sort((a, b) => (a[0] < b[0] ? 1 : -1))
          .map(([fecha, total]) => ({ fecha, total })),
      );
      setCargandoReporte(false);
    })();
  }, [mostrarReporteDoctora, doctoraReporteId, reporteDesde, reporteHasta, sedeActiva.id]);

  async function cargarEnEspera() {
    const { data } = await supabase
      .from("visitas")
      .select("id, doctora_id, pacientes(nombre), doctoras(nombre, color_pastel)")
      .eq("sede_id", sedeActiva.id)
      .eq("fecha", fecha)
      .eq("estado", "espera")
      .order("created_at");
    setEnEsperaTodas((data as unknown as VisitaRow[]) ?? []);
  }

  const enEspera = filtroDoctora ? enEsperaTodas.filter((v) => v.doctora_id === filtroDoctora) : enEsperaTodas;

  async function cargarPorCobrar() {
    const { data } = await supabase
      .from("visitas")
      .select("id, doctora_id, tratamiento, pacientes(nombre), doctoras(nombre, color_pastel)")
      .eq("sede_id", sedeActiva.id)
      .eq("fecha", fecha)
      .eq("estado", "consulta")
      .order("updated_at", { ascending: false });
    setPorCobrarTodas((data as unknown as VisitaPorCobrar[]) ?? []);
  }

  const porCobrar = filtroDoctora ? porCobrarTodas.filter((v) => v.doctora_id === filtroDoctora) : porCobrarTodas;

  useEffect(() => {
    cargarEnEspera();
    cargarPorCobrar();
    const channel = supabase
      .channel(`consultorio-${sedeActiva.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "visitas", filter: `sede_id=eq.${sedeActiva.id}` }, () => {
        cargarEnEspera();
        cargarPorCobrar();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeActiva.id, fecha]);

  useEffect(() => {
    if (buscarInstalar.trim().length < 2) {
      setPendientesInstalar([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("lab_ordenes")
        .select(
          "id, paciente_id, doctora_id, tipo_servicio, pacientes!inner(nombre), laboratorios(nombre), doctoras!lab_ordenes_doctora_id_fkey(nombre, color_pastel)",
        )
        .eq("sede_id", sedeActiva.id)
        .eq("estado", "recibido")
        .ilike("pacientes.nombre", `%${buscarInstalar.trim()}%`);
      setPendientesInstalar((data as unknown as LabPendienteInstalar[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [buscarInstalar, sedeActiva.id]);

  async function marcarInstalado(p: LabPendienteInstalar) {
    const doctoraInstala = doctoraInstalaPorOrden[p.id] ?? p.doctora_id;
    const fechaInstalado = fechaInstaladoPorOrden[p.id] ?? today();
    // mes_liquidacion queda explícito desde ya (igual a la fecha de instalación,
    // que es cuando se le paga al laboratorio) — sigue editable después si hay
    // que corregirlo a un mes distinto.
    const cambios: Record<string, unknown> = { estado: "instalado", fecha_instalado: fechaInstalado, mes_liquidacion: fechaInstalado };
    if (doctoraInstala !== p.doctora_id) {
      if (p.tipo_servicio === "reparacion") {
        // En reparación no se divide: el pago es completo para quien instala.
        cambios.doctora_id = doctoraInstala;
      } else {
        // En fabricación, si quien instala es distinta de quien tomó la impresión
        // (doctora_id), el laboratorio se divide 50/50 entre las dos.
        cambios.doctora_instala_id = doctoraInstala;
      }
    }
    await supabase.from("lab_ordenes").update(cambios).eq("id", p.id);
    setPendientesInstalar((prev) => prev.filter((x) => x.id !== p.id));
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-500">En espera de atención ({enEspera.length})</h3>
          <div className="flex items-center gap-2">
            <select
              value={filtroDoctora}
              onChange={(e) => setFiltroDoctora(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">Todas las doctoras</option>
              {doctoras.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
            <label className="text-xs text-gray-500">Fecha</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
        </div>
        <div className="space-y-2">
          {enEspera.map((v) => (
            <button
              key={v.id}
              onClick={() => setAtendiendoId(v.id)}
              className="w-full flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left hover:shadow-sm"
            >
              <span className="font-medium text-tinta">{v.pacientes?.nombre}</span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: v.doctoras?.color_pastel + "40" }}>
                {v.doctoras?.nombre}
              </span>
            </button>
          ))}
          {enEspera.length === 0 && <p className="text-sm text-gray-400">Nadie en espera.</p>}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-500 mb-2">Por cobrar — corregir valor ({porCobrar.length})</h3>
        <p className="text-xs text-gray-400 mb-2">
          Si te das cuenta de que el valor quedó mal antes de que recepción cobre, corrígelo aquí.
        </p>
        <div className="space-y-2">
          {porCobrar.map((v) => (
            <button
              key={v.id}
              onClick={() => setEditandoValorId(v.id)}
              className="w-full flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left hover:shadow-sm"
            >
              <span>
                <span className="font-medium text-tinta">{v.pacientes?.nombre}</span>
                {v.tratamiento && <span className="text-gray-400 text-sm"> · {v.tratamiento}</span>}
              </span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: v.doctoras?.color_pastel + "40" }}>
                {v.doctoras?.nombre}
              </span>
            </button>
          ))}
          {porCobrar.length === 0 && <p className="text-sm text-gray-400">Nadie pendiente de cobro todavía.</p>}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-tinta mb-3">Marcar aparato instalado</h3>
        <div className="relative mb-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={buscarInstalar}
            onChange={(e) => setBuscarInstalar(e.target.value)}
            placeholder="Buscar paciente…"
            className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          {pendientesInstalar.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm flex-wrap gap-2">
              <span className="flex items-center gap-2">
                <span>
                  {p.pacientes?.nombre} <span className="text-gray-400">· {p.laboratorios?.nombre} · {p.tipo_servicio}</span>
                </span>
                {p.doctoras && (
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full text-white shrink-0"
                    style={{ background: p.doctoras.color_pastel }}
                  >
                    {p.doctoras.nombre}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={fechaInstaladoPorOrden[p.id] ?? today()}
                  onChange={(e) => setFechaInstaladoPorOrden((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  title="Fecha de instalación (define en qué mes se liquida)"
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                />
                <select
                  value={doctoraInstalaPorOrden[p.id] ?? p.doctora_id}
                  onChange={(e) => setDoctoraInstalaPorOrden((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  title="Doctora que instala (si es distinta a quien lo envió)"
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                >
                  {doctoras.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nombre}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => marcarInstalado(p)}
                  className="flex items-center gap-1 text-[var(--acento)] font-medium text-xs"
                >
                  <CheckCircle2 size={14} /> Instalar
                </button>
              </div>
            </div>
          ))}
          {buscarInstalar.trim().length >= 2 && pendientesInstalar.length === 0 && (
            <p className="text-xs text-gray-400">Sin aparatos recibidos pendientes con ese nombre.</p>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          El selector junto a "Instalar" ya trae la doctora que envió el aparato — cámbialo solo si quien instala es
          otra. En fabricación, si cambias la doctora, el laboratorio se reparte 50/50 entre las dos; en reparación no
          se reparte, el pago completo pasa a quien instala.
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Diseño provisional — Tomás la va a revisar y ajustar antes del piloto.
        </p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        {!mostrarReporteDoctora ? (
          <button
            onClick={() => setMostrarReporteDoctora(true)}
            className="flex items-center gap-2 text-sm font-medium text-[var(--acento)]"
          >
            <Plus size={16} /> Reporte de facturación por doctora
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-tinta">Reporte de facturación por doctora</h3>
              <button onClick={() => setMostrarReporteDoctora(false)}>
                <X size={16} className="text-gray-400" />
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <select
                value={doctoraReporteId}
                onChange={(e) => setDoctoraReporteId(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Selecciona una doctora</option>
                {doctoras.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={reporteDesde}
                onChange={(e) => setReporteDesde(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
              />
              <span className="text-xs text-gray-400">a</span>
              <input
                type="date"
                value={reporteHasta}
                onChange={(e) => setReporteHasta(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
              />
            </div>
            <p className="text-xs text-gray-400 mb-2">
              Solo cuenta el procedimiento/tratamiento (no RX ni conceptos administrativos), incluyendo lo pagado con
              saldo a favor, Addi, Sistecrédito y cualquier otro medio.
            </p>
            {cargandoReporte ? (
              <p className="text-sm text-gray-400">Cargando…</p>
            ) : !doctoraReporteId ? (
              <p className="text-sm text-gray-400">Selecciona una doctora para ver su facturación día por día.</p>
            ) : (
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                {filasReporte.map((f) => (
                  <div key={f.fecha} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{f.fecha}</span>
                    <span className="font-medium">{fmtCOP(f.total)}</span>
                  </div>
                ))}
                {filasReporte.length === 0 && <p className="px-3 py-3 text-sm text-gray-400">Sin facturación en este rango.</p>}
                {filasReporte.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold bg-gray-50">
                    <span>Total del rango</span>
                    <span>{fmtCOP(filasReporte.reduce((a, f) => a + f.total, 0))}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {atendiendoId && (
        <ModalAtencion
          visitaId={atendiendoId}
          sedeId={sedeActiva.id}
          doctoras={doctoras}
          onClose={() => setAtendiendoId(null)}
          onGuardado={() => {
            setAtendiendoId(null);
            cargarEnEspera();
          }}
        />
      )}

      {editandoValorId && (
        <ModalEditarValor
          visitaId={editandoValorId}
          onClose={() => setEditandoValorId(null)}
          onGuardado={() => {
            setEditandoValorId(null);
            cargarPorCobrar();
          }}
        />
      )}
    </div>
  );
}

function ModalAtencion({
  visitaId,
  sedeId,
  doctoras,
  onClose,
  onGuardado,
}: {
  visitaId: string;
  sedeId: string;
  doctoras: Doctora[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [pacienteNombre, setPacienteNombre] = useState("");
  const [observacionAnterior, setObservacionAnterior] = useState<string | null>(null);
  const [fechaObservacionAnterior, setFechaObservacionAnterior] = useState<string | null>(null);
  const [tratamiento, setTratamiento] = useState("");
  const [valorTratamiento, setValorTratamiento] = useState("");
  const [observacion, setObservacion] = useState("");
  const [proximaCita, setProximaCita] = useState("");
  const [rxTomada, setRxTomada] = useState(false);
  const [botonTraccion, setBotonTraccion] = useState(false);
  const [botonConCadeneta, setBotonConCadeneta] = useState(false);
  const [insumos, setInsumos] = useState<Record<string, boolean>>({});
  const [precios, setPrecios] = useState<Record<string, number>>({});
  const [enviarLab, setEnviarLab] = useState(false);
  const [laboratorios, setLaboratorios] = useState<Laboratorio[]>([]);
  const [laboratorioId, setLaboratorioId] = useState("");
  const [tipoServicio, setTipoServicio] = useState(TIPOS_SERVICIO_LAB[0].value);
  const [envioDoctoraId, setEnvioDoctoraId] = useState("");
  const [enviosLab, setEnviosLab] = useState<EnvioLab[]>([]);
  const [remitido, setRemitido] = useState(false);
  const [remisionEspecialidad, setRemisionEspecialidad] = useState("");
  const [interconsulta, setInterconsulta] = useState(false);
  const [interconsultaEspecialidad, setInterconsultaEspecialidad] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: v } = await supabase
        .from("visitas")
        .select("pacientes(nombre), doctora_id, paciente_id")
        .eq("id", visitaId)
        .single();
      const visita = v as unknown as { pacientes: { nombre: string }; doctora_id: string; paciente_id: string } | null;
      setPacienteNombre(visita?.pacientes?.nombre ?? "");
      setEnvioDoctoraId(visita?.doctora_id ?? "");
      if (visita?.paciente_id) {
        const { data: anterior } = await supabase
          .from("visitas")
          .select("fecha, observacion")
          .eq("paciente_id", visita.paciente_id)
          .neq("id", visitaId)
          .order("fecha", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        setObservacionAnterior(anterior?.observacion ?? null);
        setFechaObservacionAnterior(anterior?.fecha ?? null);
      }
      const { data: preciosData } = await supabase.from("precios_config").select("clave, valor");
      const map: Record<string, number> = {};
      (preciosData ?? []).forEach((p) => (map[p.clave] = Number(p.valor)));
      setPrecios(map);
      const { data: labs } = await supabase.from("laboratorios").select("*").eq("activo", true);
      setLaboratorios((labs as Laboratorio[]) ?? []);
      if (labs && labs.length > 0) setLaboratorioId(labs[0].id);
    })();
  }, [visitaId]);

  function agregarEnvioLab() {
    const lab = laboratorios.find((l) => l.id === laboratorioId);
    const doctora = doctoras.find((d) => d.id === envioDoctoraId);
    if (!lab || !doctora) return;
    setEnviosLab((prev) => [
      ...prev,
      { laboratorioId, laboratorioNombre: lab.nombre, tipoServicio, doctoraId: doctora.id, doctoraNombre: doctora.nombre },
    ]);
  }

  function quitarEnvioLab(idx: number) {
    setEnviosLab((prev) => prev.filter((_, i) => i !== idx));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    const { data: visita } = await supabase.from("visitas").select("doctora_id, paciente_id, fecha").eq("id", visitaId).single();
    if (!visita) {
      setGuardando(false);
      return;
    }

    if (Number(valorTratamiento) > 0) {
      await supabase.from("cargos").insert({
        visita_id: visitaId,
        categoria: "procedimiento",
        concepto: tratamiento || "Procedimiento",
        valor: Number(valorTratamiento),
        registrado_en: "consultorio",
      });
    }
    if (rxTomada) {
      await supabase.from("cargos").insert({
        visita_id: visitaId,
        categoria: "rx",
        concepto: "RX",
        valor: precios["rx"] ?? 0,
        registrado_en: "consultorio",
      });
    }
    if (botonTraccion) {
      // Se cobra al paciente (concepto_administrativo, como GUM/RX) pero no
      // resta de la liquidación de honorarios de la doctora. También queda
      // en entregas_boton para llevar el inventario, igual que si se
      // registrara desde la pantalla de Inventario.
      const { error: errorCargoBoton } = await supabase.from("cargos").insert({
        visita_id: visitaId,
        categoria: "concepto_administrativo",
        concepto: "Botón de tracción",
        valor: precios["boton_traccion"] ?? 0,
        registrado_en: "consultorio",
      });
      if (errorCargoBoton) setError(errorCargoBoton.message);
      const { error: errorEntregaBoton } = await supabase.from("entregas_boton").insert({
        sede_id: sedeId,
        paciente_id: visita.paciente_id,
        doctora_id: visita.doctora_id,
        fecha: visita.fecha,
        con_cadeneta: botonConCadeneta,
      });
      if (errorEntregaBoton) setError(errorEntregaBoton.message);
    }
    for (const tipo of Object.keys(insumos).filter((k) => insumos[k])) {
      await supabase.from("insumos_consulta").insert({
        visita_id: visitaId,
        tipo,
        valor_costo: precios[tipo] ?? 0,
      });
    }
    for (const envio of enviosLab) {
      await supabase.from("lab_ordenes").insert({
        visita_id: visitaId,
        sede_id: sedeId,
        doctora_id: envio.doctoraId,
        paciente_id: visita.paciente_id,
        laboratorio_id: envio.laboratorioId,
        tipo_servicio: envio.tipoServicio,
        estado: "enviado",
        // La fecha del envío es la de la visita, no la de hoy — si se está
        // registrando con retraso una atención de un día anterior, el envío
        // al laboratorio debe quedar en el día real de la atención.
        fecha_envio: visita.fecha,
      });
    }
    if (interconsulta && interconsultaEspecialidad.trim()) {
      await supabase.from("interconsultas").insert({
        visita_id: visitaId,
        sede_id: sedeId,
        paciente_id: visita.paciente_id,
        doctora_id: visita.doctora_id,
        especialidad: interconsultaEspecialidad.trim(),
        fecha: visita.fecha,
      });
    }

    await supabase
      .from("visitas")
      .update({
        estado: "consulta",
        tratamiento,
        proxima_cita: proximaCita || null,
        observacion: observacion.trim() || null,
        remision_especialidad: remitido ? remisionEspecialidad.trim() || null : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitaId);

    setGuardando(false);
    onGuardado();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-tinta">Atención — {pacienteNombre}</h3>
          <button onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {observacionAnterior && (
          <p className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
            <span className="font-semibold">Observación de la cita anterior ({fechaObservacionAnterior}):</span>{" "}
            {observacionAnterior}
          </p>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Tratamiento</label>
          <input
            value={tratamiento}
            onChange={(e) => setTratamiento(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Valor de venta</label>
          <input
            type="number"
            value={valorTratamiento}
            onChange={(e) => setValorTratamiento(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Próxima cita</label>
          <input
            type="text"
            value={proximaCita}
            onChange={(e) => setProximaCita(e.target.value)}
            placeholder="Ej: en 3 semanas para ajuste, o 15 de agosto"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="rounded-lg bg-sky-50 border border-sky-200 p-3">
          <label className="block text-sm font-medium mb-1 text-sky-800">Observación (opcional)</label>
          <input
            value={observacion}
            onChange={(e) => setObservacion(e.target.value)}
            placeholder="Ej: el paciente debe dejar saldo a favor de $50.000"
            className="w-full rounded-lg border border-sky-200 px-3 py-2 text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rxTomada} onChange={(e) => setRxTomada(e.target.checked)} />
          RX tomada {precios["rx"] ? `(${fmtCOP(precios["rx"])})` : ""}
        </label>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={botonTraccion} onChange={(e) => setBotonTraccion(e.target.checked)} />
            Botón de tracción entregado {precios["boton_traccion"] ? `(${fmtCOP(precios["boton_traccion"])})` : ""}
          </label>
          {botonTraccion && (
            <label className="flex items-center gap-2 text-sm mt-1.5 ml-6 text-gray-500">
              <input type="checkbox" checked={botonConCadeneta} onChange={(e) => setBotonConCadeneta(e.target.checked)} />
              Con cadeneta
            </label>
          )}
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={remitido} onChange={(e) => setRemitido(e.target.checked)} />
            Remisión a otra especialidad
          </label>
          {remitido && (
            <input
              value={remisionEspecialidad}
              onChange={(e) => setRemisionEspecialidad(e.target.value)}
              placeholder="Ej: Endodoncia, Ortodoncia interceptiva…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          )}
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={interconsulta} onChange={(e) => setInterconsulta(e.target.checked)} />
            Interconsulta con otra especialidad
          </label>
          {interconsulta && (
            <input
              value={interconsultaEspecialidad}
              onChange={(e) => setInterconsultaEspecialidad(e.target.value)}
              placeholder="Especialidad a la que se remite"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          )}
          <p className="text-xs text-gray-400 mt-1">
            Queda registrada en Recepción para hacerle seguimiento hasta que llegue la respuesta.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium mb-1">Insumos de aparatología entregados</p>
          <div className="flex flex-col gap-1.5">
            {TIPOS_INSUMO_CONSULTA.map((t) => (
              <label key={t.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!insumos[t.value]}
                  onChange={(e) => setInsumos((prev) => ({ ...prev, [t.value]: e.target.checked }))}
                />
                {t.label} {precios[t.value] ? `(${fmtCOP(precios[t.value])})` : ""}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={enviarLab} onChange={(e) => setEnviarLab(e.target.checked)} />
            Enviar aparato a laboratorio
          </label>
          {enviarLab && (
            <div className="space-y-2">
              {enviosLab.length > 0 && (
                <div className="space-y-1">
                  {enviosLab.map((e, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-md bg-gray-50 px-2 py-1.5 text-sm">
                      <span>
                        {e.laboratorioNombre} · {TIPOS_SERVICIO_LAB.find((t) => t.value === e.tipoServicio)?.label}
                      </span>
                      <button onClick={() => quitarEnvioLab(idx)}>
                        <X size={14} className="text-gray-400" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <select
                  value={laboratorioId}
                  onChange={(e) => setLaboratorioId(e.target.value)}
                  className="flex-1 min-w-[120px] rounded-md border border-gray-300 px-2 py-1 text-sm"
                >
                  {laboratorios.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nombre}
                    </option>
                  ))}
                </select>
                <select
                  value={tipoServicio}
                  onChange={(e) => setTipoServicio(e.target.value)}
                  className="flex-1 min-w-[120px] rounded-md border border-gray-300 px-2 py-1 text-sm"
                >
                  {TIPOS_SERVICIO_LAB.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button onClick={agregarEnvioLab} className="rounded-md bg-gray-100 px-3 text-sm font-medium">
                  <Plus size={14} />
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Agrega uno por cada aparato (ej. si va superior e inferior, agrega los dos). Queda a nombre de la
                doctora de la visita.
              </p>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full rounded-lg bg-[var(--acento)] text-white py-2.5 text-sm font-medium disabled:opacity-40"
        >
          {guardando ? "Guardando…" : "Guardar y pasar a cobro"}
        </button>
      </div>
    </div>
  );
}

/** Corrección de valor desde consultorio para una visita que ya pasó a "por
 *  cobrar" pero todavía no se le ha aplicado el pago — para cuando la
 *  doctora se da cuenta de que el valor quedó mal antes de que recepción
 *  cobre. Solo corrige el cargo de procedimiento existente, no crea uno
 *  nuevo (eso sigue siendo tarea de "Guardar y pasar a cobro"). */
function ModalEditarValor({
  visitaId,
  onClose,
  onGuardado,
}: {
  visitaId: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [pacienteNombre, setPacienteNombre] = useState("");
  const [tratamiento, setTratamiento] = useState("");
  const [proximaCita, setProximaCita] = useState("");
  const [observacion, setObservacion] = useState("");
  const [cargoId, setCargoId] = useState<string | null>(null);
  const [valor, setValor] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: v } = await supabase
        .from("visitas")
        .select("tratamiento, proxima_cita, observacion, pacientes(nombre)")
        .eq("id", visitaId)
        .single();
      const visita = v as unknown as {
        tratamiento: string | null;
        proxima_cita: string | null;
        observacion: string | null;
        pacientes: { nombre: string };
      } | null;
      setPacienteNombre(visita?.pacientes?.nombre ?? "");
      setTratamiento(visita?.tratamiento ?? "");
      setProximaCita(visita?.proxima_cita ?? "");
      setObservacion(visita?.observacion ?? "");
      const { data: cargo } = await supabase
        .from("cargos")
        .select("id, valor")
        .eq("visita_id", visitaId)
        .eq("categoria", "procedimiento")
        .maybeSingle();
      if (cargo) {
        setCargoId(cargo.id);
        setValor(String(cargo.valor));
      }
      setCargando(false);
    })();
  }, [visitaId]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const { error: errorVisita } = await supabase
      .from("visitas")
      .update({
        tratamiento,
        proxima_cita: proximaCita.trim() || null,
        observacion: observacion.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitaId);
    if (errorVisita) {
      setGuardando(false);
      setError(errorVisita.message);
      return;
    }
    if (cargoId) {
      const { error: errorCargo } = await supabase
        .from("cargos")
        .update({ concepto: tratamiento || "Procedimiento", valor: Number(valor) || 0 })
        .eq("id", cargoId);
      if (errorCargo) {
        setGuardando(false);
        setError(errorCargo.message);
        return;
      }
    }
    setGuardando(false);
    onGuardado();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20">
      <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-tinta">Corregir — {pacienteNombre}</h3>
          <button onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {cargando ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Tratamiento</label>
              <input
                value={tratamiento}
                onChange={(e) => setTratamiento(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            {cargoId ? (
              <div>
                <label className="block text-sm font-medium mb-1">Valor de venta</label>
                <input
                  type="number"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            ) : (
              <p className="text-xs text-gray-400">
                Este paciente quedó sin cargo (cobro $0) — el valor solo se puede corregir aquí si ya existe un cargo
                de procedimiento.
              </p>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">Próxima cita</label>
              <input
                value={proximaCita}
                onChange={(e) => setProximaCita(e.target.value)}
                placeholder="Ej: en 3 semanas para ajuste, o 15 de agosto"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="rounded-lg bg-sky-50 border border-sky-200 p-3">
              <label className="block text-sm font-medium mb-1 text-sky-800">Observación (opcional)</label>
              <input
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
                placeholder="Ej: el paciente debe dejar saldo a favor de $50.000"
                className="w-full rounded-lg border border-sky-200 px-3 py-2 text-sm"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={guardar}
              disabled={guardando}
              className="w-full rounded-lg bg-[var(--acento)] text-white py-2.5 text-sm font-medium disabled:opacity-40"
            >
              {guardando ? "Guardando…" : "Guardar corrección"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
