import { useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Marker,
  Popup,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import proj4 from "proj4";
import rawPlotJson from "./data/plot.json";

const UTM47 = "+proj=utm +zone=47 +datum=WGS84 +units=m +no_defs";
const WGS84 = "EPSG:4326";

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const emptyDetail = {
  name: "",
  owner: "",
  crop: "",
};

function parseNumberList(text) {
  return String(text || "")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => !Number.isNaN(v));
}

function utmToLatLng(northing, easting) {
  const [lng, lat] = proj4(UTM47, WGS84, [easting, northing]);
  return [lat, lng];
}

function latLngToUtm(lat, lng) {
  const [easting, northing] = proj4(WGS84, UTM47, [lng, lat]);
  return { easting, northing };
}

function calculateAreaUtm(utmPoints) {
  if (utmPoints.length < 3) return 0;

  let sum = 0;

  for (let i = 0; i < utmPoints.length; i++) {
    const j = (i + 1) % utmPoints.length;
    sum += utmPoints[i].easting * utmPoints[j].northing;
    sum -= utmPoints[j].easting * utmPoints[i].northing;
  }

  return Math.abs(sum / 2);
}

function getCenterLatLng(latLngPoints) {
  if (!latLngPoints.length) return [14.6, 101.1];

  const total = latLngPoints.reduce(
    (sum, point) => {
      sum.lat += point[0];
      sum.lng += point[1];
      return sum;
    },
    { lat: 0, lng: 0 }
  );

  return [
    total.lat / latLngPoints.length,
    total.lng / latLngPoints.length,
  ];
}

function preparePlots(json) {
  const rows = Array.isArray(json) ? json : json.data || [];

  return rows.map((plot) => {
    const northings = parseNumberList(plot.plot_lat);
    const eastings = parseNumberList(plot.plot_long);

    const utmPoints = northings
      .map((northing, index) => ({
        northing,
        easting: eastings[index],
      }))
      .filter((point) => point.easting);

    const latLngPoints = utmPoints.map((point) =>
      utmToLatLng(point.northing, point.easting)
    );

    return {
      ...plot,
      utmPoints,
      latLngPoints,
      area: calculateAreaUtm(utmPoints),
      center: getCenterLatLng(latLngPoints),
    };
  });
}

function formatArea(area) {
  return `${area.toFixed(2)} ตร.ม. / ${(area / 1600).toFixed(2)} ไร่`;
}

function AddPointHandler({ isAdding, onAddPoint }) {
  useMapEvents({
    click(e) {
      if (isAdding) {
        onAddPoint([e.latlng.lat, e.latlng.lng]);
      }
    },
  });

  return null;
}

function toRawSave(plots) {
  return plots.map((plot) => ({
    plot_id: plot.plot_id,
    name: plot.name || "",
    owner: plot.owner || "",
    crop: plot.crop || "",
    plot_lat: plot.plot_lat,
    plot_long: plot.plot_long,
    point_no: plot.point_no,
  }));
}

export default function App() {
  const initialPlots = useMemo(() => preparePlots(rawPlotJson), []);

  const [plots, setPlots] = useState(() => {
    const saved = localStorage.getItem("plots");
    return saved ? preparePlots(JSON.parse(saved)) : initialPlots;
  });

  const [search, setSearch] = useState("");
  const [selectedPlotId, setSelectedPlotId] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newPoints, setNewPoints] = useState([]);

  const [newDetail, setNewDetail] = useState(emptyDetail);
  const [editDetail, setEditDetail] = useState(emptyDetail);

  const filteredPlots = plots.filter(
    (plot) =>
      String(plot.plot_id).includes(search.trim()) ||
      String(plot.name || "").toLowerCase().includes(search.toLowerCase()) ||
      String(plot.owner || "").toLowerCase().includes(search.toLowerCase()) ||
      String(plot.crop || "").toLowerCase().includes(search.toLowerCase())
  );

  const selectedPlot = plots.find((plot) => plot.plot_id === selectedPlotId);
  const mapCenter = plots[0]?.center || [14.6, 101.1];

  function selectPlot(plot) {
    setSelectedPlotId(plot.plot_id);
    setEditDetail({
      name: plot.name || "",
      owner: plot.owner || "",
      crop: plot.crop || "",
    });
  }

  function saveToLocalStorage(updatedPlots) {
    localStorage.setItem(
      "plots",
      JSON.stringify({
        success: "true",
        data: toRawSave(updatedPlots),
      })
    );
  }

  function savePlotDetail() {
    if (!selectedPlotId) {
      alert("กรุณาเลือกแปลงก่อน");
      return;
    }

    const updatedPlots = plots.map((plot) =>
      plot.plot_id === selectedPlotId
        ? {
            ...plot,
            name: editDetail.name,
            owner: editDetail.owner,
            crop: editDetail.crop,
          }
        : plot
    );

    setPlots(updatedPlots);
    saveToLocalStorage(updatedPlots);

    alert("บันทึกรายละเอียดแปลงเรียบร้อยแล้ว");
  }

  function clearNewPlot() {
    setNewDetail(emptyDetail);
    setNewPoints([]);
  }

  function saveNewPlot() {
    if (newPoints.length < 4) {
      alert("ต้องปักอย่างน้อย 4 จุดก่อนบันทึกแปลง");
      return;
    }

    const newId = Date.now();
    const utm = newPoints.map(([lat, lng]) => latLngToUtm(lat, lng));
    const closedUtm = [...utm, utm[0]];

    const newRawPlot = {
      plot_id: newId,
      name: newDetail.name || `แปลง ${newId}`,
      owner: newDetail.owner,
      crop: newDetail.crop,
      plot_lat: closedUtm.map((p) => p.northing.toFixed(5)).join(","),
      plot_long: closedUtm.map((p) => p.easting.toFixed(6)).join(","),
      point_no: closedUtm.map((_, index) => index + 1).join(","),
    };

    const updatedPlots = [...plots, ...preparePlots([newRawPlot])];

    setPlots(updatedPlots);
    saveToLocalStorage(updatedPlots);

    clearNewPlot();
    setIsAdding(false);

    alert("บันทึกแปลงใหม่เรียบร้อยแล้ว");
  }

  function downloadJson() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            success: "true",
            data: toRawSave(plots),
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plot-updated.json";
    a.click();

    URL.revokeObjectURL(url);
  }

  function resetData() {
    localStorage.removeItem("plots");
    setPlots(initialPlots);
    setSelectedPlotId(null);
    clearNewPlot();
  }

  return (
    <div className="page">
      <aside className="sidebar">
        <h1>ระบบจัดการแปลง222</h1>
        <p className="subtitle">React + Leaflet + JSON</p>

        <input
          className="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาเลขแปลง / ชื่อแปลง / เจ้าของ / พืช"
        />

        <div className="summary">
          <b>จำนวนแปลง:</b> {filteredPlots.length}
        </div>

        <button onClick={() => setIsAdding(!isAdding)} className="primary">
          {isAdding ? "หยุดเพิ่มแปลง" : "เพิ่มแปลงใหม่"}
        </button>

        {isAdding && (
          <div className="form">
            <h3>เพิ่มแปลงใหม่</h3>

            <input
              value={newDetail.name}
              onChange={(e) =>
                setNewDetail({ ...newDetail, name: e.target.value })
              }
              placeholder="ชื่อแปลง"
            />

            <input
              value={newDetail.owner}
              onChange={(e) =>
                setNewDetail({ ...newDetail, owner: e.target.value })
              }
              placeholder="เจ้าของ"
            />

            <input
              value={newDetail.crop}
              onChange={(e) =>
                setNewDetail({ ...newDetail, crop: e.target.value })
              }
              placeholder="พืช"
            />

            <p>ปักจุดแล้ว: {newPoints.length} จุด</p>

            <button onClick={() => setNewPoints((prev) => prev.slice(0, -1))}>
              ลบจุดล่าสุด
            </button>

            <button onClick={clearNewPlot}>ล้างข้อมูล</button>

            <button onClick={saveNewPlot} className="success">
              บันทึกแปลงใหม่
            </button>
          </div>
        )}

        <button onClick={downloadJson}>ดาวน์โหลด JSON</button>

        <button onClick={resetData} className="danger">
          รีเซ็ตข้อมูลเดิม
        </button>

        <h2>รายการแปลง</h2>

        <div className="plot-list">
          {filteredPlots.map((plot) => (
            <button
              key={plot.plot_id}
              className={`plot-card ${
                selectedPlotId === plot.plot_id ? "active" : ""
              }`}
              onClick={() => selectPlot(plot)}
            >
              <b>แปลง {plot.plot_id}</b>
              <span>ชื่อแปลง: {plot.name || "-"}</span>
              <span>เจ้าของ: {plot.owner || "-"}</span>
              <span>พืช: {plot.crop || "-"}</span>
              <span>{formatArea(plot.area)}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="map-area">
        <MapContainer center={mapCenter} zoom={15} className="map">
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <AddPointHandler
            isAdding={isAdding}
            onAddPoint={(point) =>
              setNewPoints((prev) => [...prev, point])
            }
          />

          {filteredPlots.map((plot) => (
            <Polygon
              key={plot.plot_id}
              positions={plot.latLngPoints}
              eventHandlers={{
                click: () => selectPlot(plot),
              }}
            >
              <Popup>
                <b>แปลง {plot.plot_id}</b>
                <br />
                ชื่อแปลง: {plot.name || "-"}
                <br />
                เจ้าของ: {plot.owner || "-"}
                <br />
                พืช: {plot.crop || "-"}
                <br />
                พื้นที่: {formatArea(plot.area)}
                <br />
                จุดกึ่งกลาง: {plot.center[0].toFixed(6)},{" "}
                {plot.center[1].toFixed(6)}
              </Popup>
            </Polygon>
          ))}

          {selectedPlot && (
            <Marker position={selectedPlot.center} icon={markerIcon}>
              <Popup>
                <b>จุดกึ่งกลางแปลง {selectedPlot.plot_id}</b>
                <br />
                {selectedPlot.center[0].toFixed(6)},{" "}
                {selectedPlot.center[1].toFixed(6)}
              </Popup>
            </Marker>
          )}

          {newPoints.length > 0 && (
            <>
              <Polygon positions={newPoints} />

              {newPoints.map((point, index) => (
                <Marker key={index} position={point} icon={markerIcon}>
                  <Popup>จุดที่ {index + 1}</Popup>
                </Marker>
              ))}
            </>
          )}
        </MapContainer>

        {selectedPlot && (
          <div className="info-panel">
            <h2>แก้ไขรายละเอียดแปลง {selectedPlot.plot_id}</h2>

            <input
              value={editDetail.name}
              onChange={(e) =>
                setEditDetail({ ...editDetail, name: e.target.value })
              }
              placeholder="ชื่อแปลง"
            />

            <input
              value={editDetail.owner}
              onChange={(e) =>
                setEditDetail({ ...editDetail, owner: e.target.value })
              }
              placeholder="เจ้าของ"
            />

            <input
              value={editDetail.crop}
              onChange={(e) =>
                setEditDetail({ ...editDetail, crop: e.target.value })
              }
              placeholder="พืช"
            />

            <button onClick={savePlotDetail} className="success">
              บันทึกรายละเอียดแปลง
            </button>

            <hr />

            <p>
              <b>พื้นที่:</b> {formatArea(selectedPlot.area)}
            </p>

            <p>
              <b>จุดกึ่งกลาง:</b>{" "}
              {selectedPlot.center[0].toFixed(6)},{" "}
              {selectedPlot.center[1].toFixed(6)}
            </p>

            <p>
              <b>จำนวนจุด:</b> {selectedPlot.latLngPoints.length}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
