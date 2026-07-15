package com.triforce.remote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NetworkPolicyTest {
    @Test
    fun cleartextIsDeniedExceptForEmulatorLoopback() {
        val xml = File("src/main/res/xml/network_security_config.xml").readText()
        assertTrue(xml.contains("<base-config cleartextTrafficPermitted=\"false\""))
        assertTrue(xml.contains(">10.0.2.2<"))
        assertFalse(xml.contains("includeSubdomains=\"true\""))
    }
}
