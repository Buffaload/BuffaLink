import React, { useEffect, useState } from "react";
import { Bar } from "react-chartjs-2";
import "chart.js/auto";

const VehicleGraph = ({ vehicles }) => {
  const [stoppedVehicles, setStoppedVehicles] = useState(0);
  const [servicesVehicles, setServicesVehicles] = useState(0);

  useEffect(() => {
    const now = Date.now();
    const stopped = vehicles.filter(
      (vehicle) =>
        vehicle.eventType === "stopped" || vehicle.eventType === "idling"
    ).length;

    const inServices = vehicles.filter(
      (vehicle) =>
        vehicle.locationGroupName === "Services and Truckstops" &&
        now - new Date(vehicle.date).getTime() > 300000 // 5 minutes
    ).length;

    setStoppedVehicles(stopped);
    setServicesVehicles(inServices);
  }, [vehicles]);

  const data = {
    labels: ["Stopped Vehicles", "Vehicles in Services"],
    datasets: [
      {
        label: "# of Vehicles",
        data: [stoppedVehicles, servicesVehicles],
        backgroundColor: ["#FF6384", "#36A2EB"],
        borderColor: ["#FF6384", "#36A2EB"],
        borderWidth: 1,
      },
    ],
  };

  return (
    <div>
      <h3>Vehicle Metrics</h3>
      <Bar data={data} />
    </div>
  );
};

export default VehicleGraph;
