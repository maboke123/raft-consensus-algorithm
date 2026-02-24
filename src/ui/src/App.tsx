import { useRaftSocket } from "./hooks/useRaftSocket";
import { EventFeed } from "./components/EventFeed";

export default function App() {
    useRaftSocket();
    return <EventFeed />;
}