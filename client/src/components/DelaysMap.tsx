import React, { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { adjustedMs, filterVehicles } from "../utils/vehicleRules"
import { isInAnyDepot } from "../utils/depotMatching";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import InlineLoader from "./InlineLoader";
import "../css/DelaysMap.css";
import API_BASE_URL from "../config";
import { Pause, Play } from "lucide-react";
import L from "leaflet";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";

// Import Leaflet CSS
import "leaflet/dist/leaflet.css";

// Define the type for a single vehicle object
interface Vehicle {
  id?: string;
  assetName: string;
  assetRegistration?: string;
  locationName?: string;
  formattedAddress?: string;
  eventType: string;
  date: string;
  locationGroupName?: string;
  assetGroupName?: string;
  assetType?: string;
  latitude?: number;
  longitude?: number;
  temperature?: number;
  // New fields from BlueCrystal API
  ServiceDueDate?: string;
  MotDueDate?: string;
  IsVor?: boolean;
  LiveDefects?: boolean;
  // Local flags
  isNightOut?: boolean;
}

interface DelaysMapProps {
  filterOption: string;
  isKioskMode: boolean;
}

const toDate = (value: string | number | Date): Date => {
  return value instanceof Date ? value : new Date(value);
};

const formatRegistration = (value?: string) => {
  if (!value) return value;

  const reg = value.trim();

  // Only act on exactly 7 characters with no existing space
  if (reg.length === 7 && !reg.includes(" ")) {
    return `${reg.slice(0, 4)} ${reg.slice(4)}`;
  }

  return reg;
};

const getIsPortraitViewport = () => {
  if (typeof window === "undefined") return false;

  const visualViewport = window.visualViewport;
  const width =
    visualViewport?.width ??
    window.innerWidth ??
    document.documentElement.clientWidth;

  const height =
    visualViewport?.height ??
    window.innerHeight ??
    document.documentElement.clientHeight;

  return (
    window.matchMedia("(orientation: portrait)").matches || height > width
  );
};

const truncatePillLabel = (value: string, maxChars: number) =>
  value.length > maxChars ? `${value.slice(0, maxChars).trimEnd()}…` : value;

const DelaysMap: React.FC<DelaysMapProps> = ({ filterOption, isKioskMode }) => {
  // Refs to persist map and markers across re-renders
  const mapRef = useRef<L.Map | null>(null);
  const clusterLayerRef = useRef<L.MarkerClusterGroup | null>(null);
  type KioskPill = "total" | "services" | "nightOut" | "depots" | "maintenance";

  // Default to "services" to match current map behaviour
  const [activeKioskPill, setActiveKioskPill] = useState<KioskPill>("services");
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);
  const [isPortraitViewport, setIsPortraitViewport] = useState(() =>
    getIsPortraitViewport()
  );

  const activeKioskPillRef = useRef<KioskPill>("services");
  const isKioskModeRef = useRef<boolean>(isKioskMode);

  const fetchVehicles = async () => {
    const token = localStorage.getItem("token");

    if (!token) {
      throw new Error("No token found. Please log in.");
    }

    const response = await axios.get(`${API_BASE_URL}/vehicles`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 200) {
      return response.data;
    }
    throw new Error("Failed to fetch vehicles");
  };

  // useQuery hook for fetching vehicles
  const {
    data: vehicles = [], //Default to an empty array
    isLoading,
    isError,
    error,
  } = useQuery<Vehicle[]>({
    queryKey: ["vehicles"],
    queryFn: fetchVehicles,
    refetchInterval: 30000, // Poll every 30 sec
    staleTime: 60000, // Data is fresh for 1 minute
  });
  
  const getPillClass = (pill: KioskPill) =>
    `figure-pill figure-pill--kiosk ${
      activeKioskPill === pill ? "is-active" : "is-inactive"
    }`;

  const kioskVehicleBuckets = useMemo(() => {
    const now = Date.now();

    const services = filterVehicles(vehicles, "Services", [], now);
    const nightOut = filterVehicles(vehicles, "Night-Out", [], now);
    const depotsRaw = filterVehicles(vehicles, "Depots", [], now);
    const depots = depotsRaw.filter(isInAnyDepot);
    const maintenance = filterVehicles(vehicles, "Maintenance", [], now);

    // TOTAL = union of pill buckets (deduped)
    const seen = new Set<string>();
    const keyOf = (v: any) => String(v.assetName ?? "");

    const total = [...services, ...nightOut, ...depots, ...maintenance].filter((v) => {
      const k = keyOf(v);
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return {
      counts: {
        total: total.length,
        services: services.length,
        nightOut: nightOut.length,
        depots: depots.length,
        maintenance: maintenance.length,
      },
      base: total,
      buckets: { services, nightOut, depot: depots, maintenance },
    };
  }, [vehicles]);

  // Destructure counts for easy access in the component
  const { counts: kioskCounts } = kioskVehicleBuckets;

  const vehiclesToPlot = useMemo(() => {
    // Plot only the selected category
    switch (activeKioskPill) {
      case "total":
        // Plot the total of all pill categories
        return kioskVehicleBuckets.base;
      case "services":
        return kioskVehicleBuckets.buckets.services;
      case "nightOut":
        return kioskVehicleBuckets.buckets.nightOut;
      case "depots":
        return kioskVehicleBuckets.buckets.depot;
      case "maintenance":
        return kioskVehicleBuckets.buckets.maintenance;
      default:
        return kioskVehicleBuckets.base;
    }
  }, [ activeKioskPill, kioskVehicleBuckets ]);

  const getClusterColor = useCallback(() => {
    switch (activeKioskPillRef.current) {
      case "total":
        return "#4b5563"; // darker grey
      case "services":
        return "#7f1d1d"; // darker red
      case "nightOut":
        return "#1e40af"; // darker blue
      case "depots":
        return "#166534"; // darker green
      case "maintenance":
        return "#d97706"; // darker amber
      default:
        return "#4b5563"
    }
  }, []);

  const createClusterIcon = useCallback((cluster: L.MarkerCluster) => {
    const count = cluster.getChildCount();
    const color = getClusterColor();

    return L.divIcon({
      html: `
        <div
          style="
            background-color: ${color};
            color: #fff;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 14px;
            opacity: 0.8;
            border: 2px solid #fff;
            box-shadow: 0 2px 6px rgba(0,0,0,0.25);
          "
        >
          ${count}
        </div>
      `,
      className: "", // important: prevents default green styles
      iconSize: L.point(44, 44),
    });
  }, [getClusterColor]);

  // Initialize Leaflet map once on component mount
  useEffect(() => {
    if (!mapRef.current) {
      // Initialize the map
      const map = L.map('map').setView([52.505, -0.80], 6.5);

      // Add OpenStreetMap tile layer
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);

      // Create markers layer group for easy management
      const clusterLayer = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 12,
        maxClusterRadius: 50,
        iconCreateFunction: createClusterIcon,
      });

      clusterLayer.addTo(map);
      clusterLayerRef.current = clusterLayer;

      // Store references
      mapRef.current = map;
    }

    // Cleanup function to remove map when component unmounts
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        clusterLayerRef.current = null;
      }
    };
  }, [createClusterIcon]);

  useEffect(() => {
    const map = mapRef.current;
    const el = document.getElementById("map");
    if (!map || !el) return;

    requestAnimationFrame(() => map.invalidateSize());

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewport = () => {
      setIsPortraitViewport((prev) => {
        const next = getIsPortraitViewport();
        return prev === next ? prev : next;
      });
    };

    updateViewport();

    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
    };
  }, []);

  useEffect(() => {
    // keep refs in sync with latest React state
    activeKioskPillRef.current = activeKioskPill;
    isKioskModeRef.current = isKioskMode;

    // force MarkerCluster to re-evaluate iconCreateFunction
    clusterLayerRef.current?.refreshClusters();
  }, [activeKioskPill, isKioskMode]);

  // Update markers when vehicle data changes
  useEffect(() => {
    if (!mapRef.current || !clusterLayerRef.current) return;

    // Clear existing markers
    clusterLayerRef.current!.clearLayers();

    const getMarkerFillColor = () => {
      switch (activeKioskPill) {
        case "total":
          return "#6b7280"; // grey
        case "services":
          return "#991b1b"; // red
        case "nightOut":
          return "#1d4ed8"; // blue
        case "depots":
          return "#15803d"; // green
        case "maintenance":
          return "#f59e0b"; // amber/yellow-ish
        default:
          return "#6b7280";
      }
    };

    const fillColor = getMarkerFillColor();

    // Plot markers for vehicles stopped > 1.5 hours in the past 30 days
    vehiclesToPlot.forEach((vehicle) => {   
    if (
          vehicle.latitude != null &&
          vehicle.longitude != null &&
          Number.isFinite(vehicle.latitude) &&
          Number.isFinite(vehicle.longitude)
        ) {
        // Create circular marker with temperature
        const circleMarker = L.circleMarker([vehicle.latitude, vehicle.longitude], {
          color: '#fff',
          fillColor,
          fillOpacity: 0.8,
          radius: 24,
          weight: 2
        });

        // Add registration text in the center of the circle
        const rawReg = formatRegistration(
          vehicle.assetRegistration ??
          vehicle.assetName?.replace(/^\[VOLVO\]\s*/i, "")
        );

        const reg = formatRegistration(rawReg) ?? "N/A";

        circleMarker.bindTooltip(reg, {
          permanent: true,
          direction: 'center',
          className: 'reg-tooltip'
        });

        // Add popup with vehicle information
        const stopDuration = Date.now() - adjustedMs(vehicle.date);
        const hours = Math.floor(stopDuration / (1000 * 60 * 60));
        const minutes = Math.floor((stopDuration % (1000 * 60 * 60)) / (1000 * 60));

        circleMarker.bindPopup(`
          <div class="leaflet-popup-app">
            <h4 style="margin: 0 0 8px 0; color: #333;">${reg}</h4>
            <p style="margin: 4px 0;"><strong>Location:</strong> ${vehicle.locationName || vehicle.formattedAddress || "Unknown"}</p>
            <p style="margin: 4px 0;"><strong>Temperature:</strong> ${vehicle.temperature}°C</p>
            <p style="margin: 4px 0;"><strong>Stopped:</strong> ${hours > 0 ? `${hours}h ` : ''}${minutes}m</p>
            <p style="margin: 4px 0;"><strong>Timestamp:</strong> ${vehicle.date ? toDate(vehicle.date) : NaN}</p>
          </div>
        `);

        // Add marker to layer group
        clusterLayerRef.current!.addLayer(circleMarker);
      }
    });

    const points = vehiclesToPlot
    .map(v => [Number(v.latitude), Number(v.longitude)] as [number, number])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

    if (points.length > 0) {
      const bounds = L.latLngBounds(points);    
      if (mapRef.current && bounds.isValid()) {
        mapRef.current.fitBounds(bounds, {
          padding: [40, 40],
          maxZoom: 12,
        });
      }
    }

  }, [vehiclesToPlot, isKioskMode, activeKioskPill]); // Only re-run when filteredVehicles changes

  // Map carousel
  const CAROUSEL_MS = 30000;
  const [pillProgressKey, setPillProgressKey] = useState(0);

  const nextPill = useCallback((pill: KioskPill): KioskPill => {
    switch (pill) {
      case "services":
        return "nightOut";
      case "nightOut":
        return "depots";
      case "depots":
        return "maintenance";
      case "maintenance":
        return "total";
      case "total":
      default:
        return "services";
    }
  }, []);

  const handlePillClick = (pill: KioskPill) => {
    setActiveKioskPill(pill);
    setIsCarouselPaused(true); // stop carousel on user interaction
  };

  useEffect(() => {
    if (isCarouselPaused) return;
    const id = window.setInterval(() => {
      setActiveKioskPill((prev) => nextPill(prev));
    }, CAROUSEL_MS);

    return () => window.clearInterval(id);
  }, [isCarouselPaused, nextPill]);

  useEffect(() => {
    // Forces CSS animation to restart
    setPillProgressKey((k) => k + 1);
  }, [activeKioskPill, isCarouselPaused]);
  
  const totalLabel =
    kioskCounts.total === 1 ? "Vehicle" : "Vehicles";

  const servicesLabel = isPortraitViewport
    ? truncatePillLabel("Services/Truckstops/Unknown", 8)
    : "Services/Truckstops/Unknown";

  const nightOutLabel = isPortraitViewport
    ? truncatePillLabel("Night-Out", 16)
    : "Night-Out";

  const depotsLabel = isPortraitViewport
    ? truncatePillLabel("Depots", 16)
    : "Depots";

  const maintenanceLabel = isPortraitViewport
    ? truncatePillLabel("Maintenance", 16)
    : "Maintenance";

  const totalDisplayLabel = isPortraitViewport
    ? truncatePillLabel(totalLabel, 10)
    : totalLabel;

  // Loading state
  if (isLoading) return (
    <div className="map-loading">
      <InlineLoader size={28} />
    </div>
  );

  // Error state
  if (isError) {
    return <p>{String(error) || "Failed to fetch vehicles."}</p>;
  }

  const pillsWizard = (
    <div className={`highlight-figures highlight-figures-kiosk ${!isKioskMode ? 'highlight-figures-header' : ''}`} aria-label="Vehicle highlights">
      <div className="kiosk-figures--row">
        <span className={`${getPillClass("total")} figure-pill--grey`}
          onClick={() => handlePillClick("total")}
          data-active={activeKioskPill === "total"}
          role="button"
          tabIndex={0}
        >    
          {activeKioskPill === "total" && !isCarouselPaused && (
            <span
              key={pillProgressKey}
              className="figure-pill-progress"
              aria-hidden="true"
            />
          )}
          <span className="figure-dot figure-dot--grey" aria-hidden="true" />
          {kioskCounts.total}{" "}
          <span
            className="figure-pill__label"
            title={totalLabel}
          >
            {totalDisplayLabel}
          </span>
        </span>
        <span className={`${getPillClass("services")} figure-pill--red`}
          onClick={() => handlePillClick("services")}
          data-active={activeKioskPill === "services"}
          role="button"
          tabIndex={0}
        >
          {activeKioskPill === "services" && !isCarouselPaused && (
            <span
              key={pillProgressKey}
              className="figure-pill-progress"
              aria-hidden="true"
            />
          )}
          <span className="figure-dot figure-dot--red" aria-hidden="true" />
          {kioskCounts.services}{" "}
          <span
            className="figure-pill__label"
            title="Services/Truckstops/Unknown"
          >
            {servicesLabel}
          </span>
        </span>
        <span className={`${getPillClass("nightOut")} figure-pill--blue`}
          onClick={() => handlePillClick("nightOut")}
          data-active={activeKioskPill === "nightOut"}
          role="button"
          tabIndex={0}
        >
          {activeKioskPill === "nightOut" && !isCarouselPaused && (
            <span
              key={pillProgressKey}
              className="figure-pill-progress"
              aria-hidden="true"
            />
          )}
          <span className="figure-dot figure-dot--blue" aria-hidden="true" />
          {kioskCounts.nightOut}{" "}
          <span
            className="figure-pill__label"
            title="Night-Out"
          >
            {nightOutLabel}
          </span>
        </span>
        <span className={`${getPillClass("depots")} figure-pill--green`}
          onClick={() => handlePillClick("depots")}
          data-active={activeKioskPill === "depots"}
          role="button"
          tabIndex={0}
        >
          {activeKioskPill === "depots" && !isCarouselPaused && (
            <span
              key={pillProgressKey}
              className="figure-pill-progress"
              aria-hidden="true"
            />
          )}
          <span className="figure-dot figure-dot--green" aria-hidden="true" />
          {kioskCounts.depots}{" "}
          <span
            className="figure-pill__label"
            title="Depots"
          >
            {depotsLabel}
          </span>
        </span>
        <span className={`${getPillClass("maintenance")} figure-pill--orange`}
          onClick={() => handlePillClick("maintenance")}
          data-active={activeKioskPill === "maintenance"}
          role="button"
          tabIndex={0}
        >
          {activeKioskPill === "maintenance" && !isCarouselPaused && (
            <span
              key={pillProgressKey}
              className="figure-pill-progress"
              aria-hidden="true"
            />
          )}
          <span className="figure-dot figure-dot--orange" aria-hidden="true" />
          {kioskCounts.maintenance}{" "}
          <span
            className="figure-pill__label"
            title="Maintenance"
          >
            {maintenanceLabel}
          </span>
        </span>
      </div>

      <div className="kiosk-figures--row">
        <button
          type="button"
          className="figure-pill figure-pill--kiosk figure-pill--control"
          onClick={() => setIsCarouselPaused((p) => !p)}
          aria-label={isCarouselPaused ? "Play category carousel" : "Pause category carousel"}
          title={isCarouselPaused ? "Play" : "Pause"}
        >
          {isCarouselPaused ? <Play size={16} /> : <Pause size={16} />}
        </button>
      </div>
    </div>
  );

  const headerEl =
    document.querySelector(".app-header");

  const pillsInHeader = headerEl
    ? createPortal(pillsWizard, headerEl)
    : pillsWizard;

  return (
    <>
      {pillsInHeader}
      <div className="map-viewport">
        <div className="location-services-container">
          <div id="map"></div>
        </div>
      </div>
    </>
  );
};

export default DelaysMap;