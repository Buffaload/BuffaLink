import React, { useMemo, useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
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

const DelaysMap: React.FC<DelaysMapProps> = ({ filterOption, isKioskMode }) => {
  // Refs to persist map and markers across re-renders
  const mapRef = useRef<L.Map | null>(null);
  const clusterLayerRef = useRef<L.MarkerClusterGroup | null>(null);
  type KioskPill = "total" | "services" | "nightOut" | "depots" | "maintenance";

  // Default to "services" to match current map behaviour
  const [activeKioskPill, setActiveKioskPill] = useState<KioskPill>("services");
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);

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
      console.log("🚀 BACKEND DEBUG:", response.data.debug)
      return response.data.data;
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

  // Flip this to false when BST ends
  const APPLY_BST_FIX = true;
  const BST_OFFSET_MS = APPLY_BST_FIX ? 60 * 60 * 1000 : 0;

  // Add 1h only for "naive" timestamps (no timezone in the string)
  const adjustedMs = useCallback(
    (s: string): number => {
      if (!s) return NaN;
      const naive = !/Z$|[+-]\d\d:?\d\d$/.test(s);
      return new Date(s).getTime() + (naive ? BST_OFFSET_MS : 0);
    },
    [BST_OFFSET_MS]
  );

  // const calculateTimeStopped = (lastUpdate: string): number => {
  //   return now - adjustedMs(lastUpdate);
  // };
  
  const getPillClass = (pill: KioskPill) =>
    `figure-pill figure-pill--kiosk ${
      activeKioskPill === pill ? "is-active" : "is-inactive"
    }`;
  
  type VehicleCategory = "nightOut" | "maintenance" | "depot" | "services" | "other";

  // const normalise = (value?: string) => (value ?? "").trim();

  const getVehicleCategory = useCallback((v: Vehicle): VehicleCategory => {
    if (v.isNightOut) return "nightOut";
    if (v.locationGroupName === "Maintenance") return "maintenance";
    if (v.locationGroupName === "Buffaload") return "depot";
    if (
      v.assetType === "HGV" &&
      (v.locationGroupName === "Services and Truckstops" || !v.locationGroupName)
    ) {
      return "services";
    }
    return "other";
  }, []);

  const kioskVehicleBuckets = useMemo(() => {
    // Base set for kiosk counts: HGVs only, exclude tipper op (matches your delays exclusions)
    const base = vehicles.filter(
      (v) => v.assetType === "HGV" && v.assetGroupName !== "TFP Tipper Operation"
    );

    const buckets: Record<VehicleCategory, Vehicle[]> = {
      nightOut: [],
      maintenance: [],
      depot: [],
      services: [],
      other: [],
    };

    for (const v of base) {
      buckets[getVehicleCategory(v)].push(v);
    }
    
    const servicesCount = buckets.services.length;
    const nightOutCount = buckets.nightOut.length;
    const depotsCount = buckets.depot.length;
    const maintenanceCount = buckets.maintenance.length;

    return {
      counts: {
        total:
          servicesCount +
          nightOutCount +
          depotsCount +
          maintenanceCount,
        services: servicesCount,
        nightOut: nightOutCount,
        depots: depotsCount,
        maintenance: maintenanceCount,
      },
      base,
      buckets,
    };
  }, [vehicles, getVehicleCategory]);

  // Destructure counts for easy access in the component
  const { counts: kioskCounts } = kioskVehicleBuckets;

  const filteredVehicles = useMemo(() => {
    const now = Date.now();

    return vehicles.filter((vehicle) => {
      const vehicleTime = adjustedMs(vehicle.date);
      const timeStopped = now - vehicleTime;

      // Filter for vehicles that stopped for > 1.5 hours (90 minutes) in the past 30 days
      // at Services/Truckstops/Unknown locations
      return (
        vehicle.assetType === "HGV" &&
        vehicle.latitude !== undefined &&
        vehicle.longitude !== undefined &&
        (vehicle.locationGroupName === "Services and Truckstops" ||
          !vehicle.locationGroupName) &&
        timeStopped > 90 * 60 * 1000 && // Stopped for more than 90 minutes (1.5 hours)
        timeStopped <= 30 * 24 * 60 * 60 * 1000 && // Within the past 30 days
        vehicle.eventType !== "driving" &&
        vehicle.locationGroupName !== "Buffaload" && // Exclude depots
        vehicle.locationGroupName !== "Maintenance" && // Exclude maintenance
        vehicle.assetGroupName !== "TFP Tipper Operation" && // Exclude tippers
        !vehicle.isNightOut // Exclude Night-Out vehicles
      );
    });
  }, [vehicles, adjustedMs]);

  const vehiclesToPlot = useMemo(() => {
    // Non-kiosk mode remains unchanged: plot the Delays subset only
    if (!isKioskMode) return filteredVehicles;

    // Kiosk mode: plot only the selected category
    switch (activeKioskPill) {
      case "total":
        // Plot all base vehicles that your kiosk counts represent (HGVs excluding tippers)
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
  }, [
    isKioskMode,
    activeKioskPill,
    filteredVehicles,
    kioskVehicleBuckets,
  ]);

  const getClusterColor = useCallback(() => {
    if (!isKioskModeRef.current) return "#991b1b"; // current delays red
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
    // keep refs in sync with latest React state
    activeKioskPillRef.current = activeKioskPill;
    isKioskModeRef.current = isKioskMode;

    // force MarkerCluster to re-evaluate iconCreateFunction
    clusterLayerRef.current?.refreshClusters();
  }, [activeKioskPill, isKioskMode]);

  // Update markers when vehicle data changes
  useEffect(() => {
    if (!mapRef.current || !clusterLayerRef.current) return;

    // Check vehicle long/lat data for mapping issues
    // vehiclesToPlot.forEach(v => {
    //   console.log(
    //     v.assetName,
    //     v.locationGroupName,
    //     v.latitude,
    //     v.longitude,
    //     typeof v.latitude,
    //     typeof v.longitude
    //   );
    // });


    // Clear existing markers
    clusterLayerRef.current!.clearLayers();

    const getMarkerFillColor = () => {
      if (!isKioskMode) return "#991b1b"; // current delays red
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
      if (vehicle.latitude && vehicle.longitude) {
        // Create circular marker with temperature
        const circleMarker = L.circleMarker([vehicle.latitude, vehicle.longitude], {
          color: '#fff',
          fillColor,
          fillOpacity: 0.8,
          radius: 24,
          weight: 2
        });

        // Add registration text in the center of the circle
        const regValue = vehicle.assetName;
        const reg =
          regValue !== undefined && regValue !== null 
            ? regValue.split(" - ")[0] // Extract registration from assetName
            : 'N/A';
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
          <div style="font-family: Arial, sans-serif; max-width: 200px;">
            <h4 style="margin: 0 0 8px 0; color: #333;">${reg}</h4>
            <p style="margin: 4px 0;"><strong>Location:</strong> ${vehicle.locationName || vehicle.formattedAddress || "Unknown"}</p>
            <p style="margin: 4px 0;"><strong>Temperature:</strong> ${vehicle.temperature}°C</p>
            <p style="margin: 4px 0;"><strong>Stopped:</strong> ${hours > 0 ? `${hours}h ` : ''}${minutes}m</p>
            <p style="margin: 4px 0;"><strong>Timestamp:</strong> ${new Date(vehicle.date).toLocaleString()}</p>
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

  }, [vehiclesToPlot, isKioskMode, activeKioskPill, adjustedMs]); // Only re-run when filteredVehicles changes

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
    if (!isKioskMode) return;
    if (isCarouselPaused) return;

    const id = window.setInterval(() => {
      setActiveKioskPill((prev) => nextPill(prev));
    }, CAROUSEL_MS);

    return () => window.clearInterval(id);
  }, [isKioskMode, isCarouselPaused, nextPill]);

  useEffect(() => {
    // Forces CSS animation to restart
    setPillProgressKey((k) => k + 1);
  }, [activeKioskPill, isCarouselPaused]);
  
  // Loading state
  if (isLoading) return <p>Loading vehicles...</p>;

  // Error state
  if (isError) {
    return <p>{String(error) || "Failed to fetch vehicles."}</p>;
  }

  return (
    <div className="location-services-container">
      {(!isKioskMode) ? (
        <div className="highlight-figures highlight-figures-map" aria-label="Vehicle highlights">
          <span className="figure-pill figure-pill--red">
            <span className="figure-dot figure-dot--red" aria-hidden="true" />
            {filteredVehicles.length}{" "} Vehicle {" "}
            {filteredVehicles.length === 1 ? "stop" : "stops"}
          </span>
        </div>
      ) : (
        <div className="highlight-figures highlight-figures-kiosk" aria-label="Vehicle highlights">
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
              {kioskCounts.total === 1 ? "Vehicle" : "Vehicles"}
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
              {kioskCounts.services}{" "} Services/Truckstops/Unknown {" "}
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
              {kioskCounts.nightOut}{" "} Night-Out {" "}
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
              {kioskCounts.depots}{" "} Depots {" "}
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
              {kioskCounts.maintenance}{" "} Maintenance {" "}
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
      ) }
      <div id="map"></div>
    </div>
  );
};

export default DelaysMap;