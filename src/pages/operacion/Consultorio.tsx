import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { CheckCircle2, X, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtCOP, today } from "../../lib/format";
import { TIPOS_INSUMO_CONSULTA, TIPOS_SERVICIO_LAB, type Sede, type Laboratorio } from "../../lib/types";

interface VisitaRow {
  id: string;
  doctora_id: string;
  pacientes: { nombre: string };
  doctoras: { nombre: string; color_pastel: string };
}

interface LabPendienteInstalar {
  id: string;
  paciente_id: string;
  pacientes: { nombre: string };
  laboratorios: { nombre: string };
  tipo_servicio: string;
}

export function Consultorio() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [fecha, setFecha] = useState(today());
  const [enEspera, setEnEspera] = useState<VisitaRow[]>([]);
  const [atendiendoId, setAtendiendoId] = useState<string | null>(null);
  const [buscarInstalar, setBuscarInstalar] = useState("");
  const [pendientesInstalar, setPendientesInstalar] = useState<LabPendienteInstalar[]>([]);

  async function cargarEnEspera() {
    const { data } = await supabase
      .from("visitas")
      .select("id, doctora_id, pacientes(nombre), doctoras(nombre, color_pastel)")
      .eq("sede_id", sedeActiva.id)
      .eq("fecha", fecha)
      .eq("estado", "espera")
      .order("created_at");
    setEnEspera((data as unknown as VisitaRow[]) ?? []);
  }

  useEffect(() => {
    cargarEnEspera();
    const channel = supabase
      .channel(`consultorio-${sedeActiva.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "visitas", filter: `sede_id=eq.${sedeActiva.id}` }, cargarEnEspera)
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
        .select("id, paciente_id, tipo_servicio, pacientes!inner(nombre), laboratorios(nombre)")
        .eq("sede_id", sedeActiva.id)
        .eq("estado", "recibido")
        .ilike("pacientes.nombre", `%${buscarInstalar.trim()}%`);
      setPendientesInstalar((data as unknown as LabPendienteInstalar[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [buscarInstalar, sedeActiva.id]);

  async function marcarInstalado(id: string) {
    await supabase.from("lab_ordenes").update({ estado: "instalado", fecha_instalado: today() }).eq("id", id);
    setPendientesInstalar((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-500">En espera de atención ({enEspera.length})</h3>
          <div className="flex items-center gap-2">
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
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <span>
                {p.pacientes?.nombre} <span className="text-gray-400">· {p.laboratorios?.nombre} · {p.tipo_servicio}</span>
              </span>
              <button
                onClick={() => marcarInstalado(p.id)}
                className="flex items-center gap-1 text-[var(--acento)] font-medium text-xs"
              >
                <CheckCircle2 size={14} /> Instalar
              </button>
            </div>
          ))}
          {buscarInstalar.trim().length >= 2 && pendientesInstalar.length === 0 && (
            <p className="text-xs text-gray-400">Sin aparatos recibidos pendientes con ese nombre.</p>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Diseño provisional — Tomás la va a revisar y ajustar antes del piloto.
        </p>
      </section>

      {atendiendoId && (
        <ModalAtencion
          visitaId={atendiendoId}
          sedeId={sedeActiva.id}
          onClose={() => setAtendiendoId(null)}
          onGuardado={() => {
            setAtendiendoId(null);
            cargarEnEspera();
          }}
        />
      )}
    </div>
  );
}

function ModalAtencion({
  visitaId,
  sedeId,
  onClose,
  onGuardado,
}: {
  visitaId: string;
  sedeId: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [pacienteNombre, setPacienteNombre] = useState("");
  const [tratamiento, setTratamiento] = useState("");
  const [valorTratamiento, setValorTratamiento] = useState("");
  const [proximaCita, setProximaCita] = useState("");
  const [rxTomada, setRxTomada] = useState(false);
  const [insumos, setInsumos] = useState<Record<string, boolean>>({});
  const [precios, setPrecios] = useState<Record<string, number>>({});
  const [enviarLab, setEnviarLab] = useState(false);
  const [laboratorios, setLaboratorios] = useState<Laboratorio[]>([]);
  const [laboratorioId, setLaboratorioId] = useState("");
  const [tipoServicio, setTipoServicio] = useState(TIPOS_SERVICIO_LAB[0].value);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: v } = await supabase.from("visitas").select("pacientes(nombre)").eq("id", visitaId).single();
      setPacienteNombre((v as unknown as { pacientes: { nombre: string } })?.pacientes?.nombre ?? "");
      const { data: preciosData } = await supabase.from("precios_config").select("clave, valor");
      const map: Record<string, number> = {};
      (preciosData ?? []).forEach((p) => (map[p.clave] = Number(p.valor)));
      setPrecios(map);
      const { data: labs } = await supabase.from("laboratorios").select("*").eq("activo", true);
      setLaboratorios((labs as Laboratorio[]) ?? []);
      if (labs && labs.length > 0) setLaboratorioId(labs[0].id);
    })();
  }, [visitaId]);

  async function guardar() {
    setGuardando(true);
    const { data: visita } = await supabase.from("visitas").select("doctora_id, paciente_id").eq("id", visitaId).single();
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
    for (const tipo of Object.keys(insumos).filter((k) => insumos[k])) {
      await supabase.from("insumos_consulta").insert({
        visita_id: visitaId,
        tipo,
        valor_costo: precios[tipo] ?? 0,
      });
    }
    if (enviarLab && laboratorioId) {
      await supabase.from("lab_ordenes").insert({
        visita_id: visitaId,
        sede_id: sedeId,
        doctora_id: visita.doctora_id,
        paciente_id: visita.paciente_id,
        laboratorio_id: laboratorioId,
        tipo_servicio: tipoServicio,
        estado: "enviado",
        fecha_envio: today(),
      });
    }

    await supabase
      .from("visitas")
      .update({
        estado: "consulta",
        tratamiento,
        proxima_cita: proximaCita || null,
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

        <div>
          <label className="block text-sm font-medium mb-1">Tratamiento</label>
          <input
            value={tratamiento}
            onChange={(e) => setTratamiento(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Valor del tratamiento (honorario doctora)</label>
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

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rxTomada} onChange={(e) => setRxTomada(e.target.checked)} />
          RX tomada {precios["rx"] ? `(${fmtCOP(precios["rx"])})` : ""}
        </label>

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
            <div className="flex gap-2">
              <select
                value={laboratorioId}
                onChange={(e) => setLaboratorioId(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
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
                className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
              >
                {TIPOS_SERVICIO_LAB.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

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
